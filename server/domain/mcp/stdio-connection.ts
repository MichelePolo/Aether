import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { CallToolOpts, McpConnection } from './connection.types';
import type { McpTool, McpToolResult } from './mcp.types';
import { JsonRpcResponseSchema, ToolsListResultSchema } from './mcp.schema';

export interface StdioOpts {
  command: string;
  args: string[];
  env: Record<string, string>;
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

export class StdioMcpConnection implements McpConnection {
  readonly defaultAutoApprove = false;

  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, PendingCall>();
  private nextId = 1;
  private buf = '';
  private stderrBuf = '';
  private unexpectedCloseHandler: (() => void) | null = null;
  private closeRequested = false;

  constructor(private readonly opts: StdioOpts) {}

  async initialize(): Promise<void> {
    this.proc = spawn(this.opts.command, this.opts.args, {
      env: { ...process.env, ...this.opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.on('error', (err) => this.failAllPending(err));
    this.proc.on('exit', (code) => {
      this.failAllPending(
        new Error(`subprocess exited (code ${code}); stderr: ${this.stderrBuf.slice(-512)}`),
      );
      if (!this.closeRequested && this.unexpectedCloseHandler) {
        this.unexpectedCloseHandler();
      }
    });
    this.proc.stdout.setEncoding('utf-8');
    this.proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf-8');
    this.proc.stderr.on('data', (chunk: string) => {
      this.stderrBuf = (this.stderrBuf + chunk).slice(-4096);
    });
    await this.rpc('initialize', {}, INITIALIZE_TIMEOUT_MS);
  }

  async listTools(): Promise<McpTool[]> {
    const raw = await this.rpc('tools/list', {});
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
      const out = await this.rpcWithOpts(
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

  __killForTest(): void {
    if (this.proc) this.proc.kill('SIGKILL');
  }

  async close(): Promise<void> {
    this.closeRequested = true;
    if (!this.proc) return;
    this.failAllPending(new Error('connection closed'));
    try {
      this.proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    await delay(50);
    try {
      if (this.proc.exitCode === null) this.proc.kill('SIGKILL');
    } catch {
      // ignore
    }
    this.proc = null;
  }

  private async rpc(method: string, params: unknown, timeoutMs = TOOLS_CALL_TIMEOUT_MS): Promise<unknown> {
    return this.rpcWithOpts(method, params, timeoutMs);
  }

  private async rpcWithOpts(
    method: string,
    params: unknown,
    timeoutMs: number,
    opts?: CallToolOpts,
  ): Promise<unknown> {
    if (!this.proc) throw new Error('not initialized');
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
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
        try {
          const note =
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/cancelled',
              params: { requestId: id, reason: 'Cancelled by user' },
            }) + '\n';
          this.proc?.stdin.write(note);
        } catch {
          // ignore
        }
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

      this.proc!.stdin.write(payload, (err) => {
        if (err) {
          if (this.cleanupPending(id)) reject(err);
        }
      });
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

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      // Check for progress notification (no id, has method)
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
        continue;
      }
      const resp = JsonRpcResponseSchema.safeParse(parsed);
      if (!resp.success) continue;
      const id = typeof resp.data.id === 'string' ? Number(resp.data.id) : resp.data.id;
      const p = this.cleanupPending(id);
      if (!p) continue;
      if (resp.data.error) {
        p.reject(new Error(resp.data.error.message));
      } else {
        p.resolve(resp.data.result);
      }
    }
  }

  private failAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      if (p.signal && p.onAbort) {
        p.signal.removeEventListener('abort', p.onAbort);
      }
      p.reject(err);
    }
    this.pending.clear();
  }
}
