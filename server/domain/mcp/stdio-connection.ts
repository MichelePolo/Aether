import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { McpConnection } from './connection.types';
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

  constructor(private readonly opts: StdioOpts) {}

  async initialize(): Promise<void> {
    this.proc = spawn(this.opts.command, this.opts.args, {
      env: { ...process.env, ...this.opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.on('error', (err) => this.failAllPending(err));
    this.proc.on('exit', (code) =>
      this.failAllPending(
        new Error(`subprocess exited (code ${code}); stderr: ${this.stderrBuf.slice(-512)}`),
      ),
    );
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

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    try {
      const out = await this.rpc('tools/call', { name, arguments: args }, TOOLS_CALL_TIMEOUT_MS);
      return { ok: true, output: out };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'tool call failed' };
    }
  }

  async close(): Promise<void> {
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
    if (!this.proc) throw new Error('not initialized');
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc!.stdin.write(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
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
      const resp = JsonRpcResponseSchema.safeParse(parsed);
      if (!resp.success) continue;
      const id = typeof resp.data.id === 'string' ? Number(resp.data.id) : resp.data.id;
      const p = this.pending.get(id);
      if (!p) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
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
      p.reject(err);
    }
    this.pending.clear();
  }
}
