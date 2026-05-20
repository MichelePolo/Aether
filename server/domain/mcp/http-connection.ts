import type { CallToolOpts, McpConnection } from './connection.types';
import type { McpTool, McpToolResult } from './mcp.types';
import { JsonRpcResponseSchema, ToolsListResultSchema } from './mcp.schema';

export interface HttpOpts {
  url: string;
  headers?: Record<string, string>;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  onProgress?: (note: string) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const INITIALIZE_TIMEOUT_MS = 5_000;
const TOOLS_CALL_TIMEOUT_MS = 30_000;

export class HttpMcpConnection implements McpConnection {
  readonly defaultAutoApprove = false;

  private pending = new Map<number, PendingCall>();
  private nextId = 1;
  private unexpectedCloseHandler: (() => void) | null = null;
  private closeRequested = false;

  constructor(private readonly opts: HttpOpts) {}

  async initialize(): Promise<void> {
    await this.postRpc('initialize', {}, INITIALIZE_TIMEOUT_MS);
  }

  async listTools(): Promise<McpTool[]> {
    const raw = await this.postRpc('tools/list', {}, TOOLS_CALL_TIMEOUT_MS);
    const parsed = ToolsListResultSchema.safeParse(raw);
    if (!parsed.success) throw new Error('tools/list response failed schema');
    return parsed.data.tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: CallToolOpts,
  ): Promise<McpToolResult> {
    if (opts?.signal?.aborted) {
      return { ok: false, error: 'Cancelled by user' };
    }
    try {
      const out = await this.postRpc(
        'tools/call',
        { name, arguments: args },
        TOOLS_CALL_TIMEOUT_MS,
        opts,
      );
      return { ok: true, output: out };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'tool call failed' };
    }
  }

  onUnexpectedClose(handler: () => void): void {
    this.unexpectedCloseHandler = handler;
  }

  async close(): Promise<void> {
    this.closeRequested = true;
    const ids = Array.from(this.pending.keys());
    for (const id of ids) {
      const p = this.cleanupPending(id);
      if (p) p.reject(new Error('connection closed'));
    }
  }

  private async postRpc(
    method: string,
    params: unknown,
    timeoutMs: number,
    opts?: CallToolOpts,
  ): Promise<unknown> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.cleanupPending(id)) {
          reject(new Error(`rpc timeout: ${method}`));
        }
      }, timeoutMs);
      const entry: PendingCall = { resolve, reject, timer, onProgress: opts?.onProgress };
      this.pending.set(id, entry);

      const onAbort = (): void => {
        const p = this.cleanupPending(id);
        if (!p) return;
        // Best-effort: notify the server.
        void this.postCancelled(id);
        p.reject(new Error('Cancelled by user'));
      };

      if (opts?.signal) {
        if (opts.signal.aborted) {
          onAbort();
          return;
        }
        entry.signal = opts.signal;
        entry.onAbort = onAbort;
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }

      void this.openSseStream(id, body, method);
    });
  }

  private cleanupPending(id: number): PendingCall | undefined {
    const p = this.pending.get(id);
    if (!p) return undefined;
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (p.signal && p.onAbort) {
      p.signal.removeEventListener('abort', p.onAbort);
    }
    return p;
  }

  private async openSseStream(id: number, body: string, method: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(this.opts.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(this.opts.headers ?? {}),
        },
        body,
      });
    } catch (err) {
      const p = this.cleanupPending(id);
      if (p) p.reject(err instanceof Error ? err : new Error(String(err)));
      if (!this.closeRequested && this.unexpectedCloseHandler) {
        this.unexpectedCloseHandler();
      }
      return;
    }

    if (!res.ok || !res.body) {
      let text = '';
      try {
        text = await res.text();
      } catch {
        // ignore
      }
      const p = this.cleanupPending(id);
      if (p) p.reject(new Error(`HTTP ${res.status}: ${text}`));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      // Stream loop
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            }
          }
          if (dataLines.length === 0) continue;
          const joined = dataLines.join('');
          let parsed: unknown;
          try {
            parsed = JSON.parse(joined);
          } catch {
            continue;
          }
          const settled = this.handleFrame(parsed, id);
          if (settled) {
            // Drain remaining body but we can stop early.
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            return;
          }
        }
      }
    } catch (err) {
      const p = this.cleanupPending(id);
      if (p) p.reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // Stream closed without a response frame for this id.
    if (this.pending.has(id)) {
      const p = this.cleanupPending(id);
      if (p) p.reject(new Error(`stream closed without response (${method})`));
    }
  }

  /**
   * Returns true if the frame settled the pending call for `awaitingId`.
   */
  private handleFrame(parsed: unknown, awaitingId: number): boolean {
    if (
      parsed &&
      typeof parsed === 'object' &&
      !('id' in (parsed as Record<string, unknown>)) &&
      (parsed as { method?: unknown }).method === 'notifications/progress'
    ) {
      const params = (parsed as { params?: Record<string, unknown> }).params ?? {};
      const token = params.progressToken;
      const tokenId = typeof token === 'string' ? Number(token) : (token as number);
      const p = this.pending.get(tokenId);
      if (p?.onProgress) {
        const progress = params.progress;
        const total = params.total;
        const message = params.message ?? '';
        p.onProgress(`${progress}/${total ?? '?'} — ${message}`);
      }
      return false;
    }
    const resp = JsonRpcResponseSchema.safeParse(parsed);
    if (!resp.success) return false;
    const id = typeof resp.data.id === 'string' ? Number(resp.data.id) : resp.data.id;
    if (id !== awaitingId) return false;
    const p = this.cleanupPending(id);
    if (!p) return false;
    if (resp.data.error) {
      p.reject(new Error(resp.data.error.message));
    } else {
      p.resolve(resp.data.result);
    }
    return true;
  }

  private async postCancelled(requestId: number): Promise<void> {
    try {
      await fetch(this.opts.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(this.opts.headers ?? {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId, reason: 'Cancelled by user' },
        }),
      });
    } catch {
      // best-effort
    }
  }
}
