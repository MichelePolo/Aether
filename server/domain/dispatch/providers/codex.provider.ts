import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpBridgeService } from '@/server/domain/mcp/bridge/bridge.service';
import { renderConversation } from './conversation';
import type {
  AIProvider,
  ProviderCapabilities,
  ProviderChunk,
  ProviderRequest,
  ProviderUsage,
} from './provider.types';

const SIGKILL_GRACE_MS = 2_000;

export interface CodexProviderOpts {
  model: string;
  /** Absolute path to the codex binary (from resolveCodexBinary). */
  binaryPath: string;
  /** Lazy because the actual bound port is only known after listen(). Returns
   *  e.g. `http://127.0.0.1:3000/api/mcp-bridge` (no trailing slash). */
  bridgeBaseUrl: () => string;
  bridge: McpBridgeService;
  /** Test seam (same pattern as the fetch override in AuthStatusService). */
  spawnImpl?: typeof spawn;
}

/** Parsed view of one `codex exec --json` JSONL line. Tolerant by design:
 *  unknown event types, non-JSON lines and shape drift map to null. */
export type CodexParsedEvent =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'done'; usage?: ProviderUsage }
  | { kind: 'error'; message: string };

export function parseCodexEvent(line: string): CodexParsedEvent | null {
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (ev === null || typeof ev !== 'object') return null;
  const type = ev.type;

  if (type === 'item.completed') {
    const item = ev.item as { type?: string; text?: string } | undefined;
    if (!item || typeof item.text !== 'string') return null;
    if (item.type === 'agent_message') return { kind: 'text', text: item.text };
    if (item.type === 'reasoning' || item.type === 'agent_reasoning') {
      return { kind: 'thinking', text: item.text };
    }
    return null;
  }
  if (type === 'turn.completed') {
    const usage = ev.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    const input = typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined;
    const output = typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined;
    const total = (input ?? 0) + (output ?? 0);
    return {
      kind: 'done',
      ...(total > 0
        ? {
            usage: {
              totalTokens: total,
              ...(input !== undefined ? { inputTokens: input } : {}),
              ...(output !== undefined ? { outputTokens: output } : {}),
            },
          }
        : {}),
    };
  }
  if (type === 'turn.failed') {
    const err = ev.error as { message?: string } | undefined;
    return { kind: 'error', message: err?.message ?? 'codex turn failed' };
  }
  if (type === 'error') {
    return { kind: 'error', message: typeof ev.message === 'string' ? ev.message : 'codex error' };
  }
  return null;
}

/**
 * Codex CLI as a provider: spawns `codex exec --json` (ChatGPT-subscription
 * auth read by the CLI itself from $CODEX_HOME — Aether never touches it) and
 * maps JSONL events to ProviderChunks. Like AnthropicProvider, the agentic
 * tool loop runs INSIDE the CLI: Aether's MCP tools are exposed through the
 * loopback bridge and every call re-enters req.runToolCall (gate + tracing),
 * so no `function_call` chunks are emitted. Codex's own shell is confined to
 * `-s read-only` (accepted limitation: ungated reads).
 */
export class CodexProvider implements AIProvider {
  readonly capabilities: ProviderCapabilities = { thinking: true, toolCalling: true, vision: true };
  readonly model: string;

  constructor(private readonly opts: CodexProviderOpts) {
    this.model = opts.model;
  }

  async *stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const args = [
      'exec', '--json', '--ephemeral', '--skip-git-repo-check',
      '-s', 'read-only', '--ignore-user-config', '--color', 'never',
      '-m', this.model,
    ];

    let token: string | null = null;
    if (req.mcpTools && req.mcpTools.length > 0 && req.runToolCall) {
      token = this.opts.bridge.register(req.mcpTools, req.runToolCall);
      args.push('-c', `mcp_servers.aether.url="${this.opts.bridgeBaseUrl()}/${token}"`);
    }

    let tmpDir: string | null = null;
    const images = (req.attachments ?? []).filter((a) => a.mime.startsWith('image/'));
    if (images.length > 0) {
      tmpDir = mkdtempSync(join(tmpdir(), 'aether-codex-'));
      images.forEach((a, i) => {
        const file = join(tmpDir as string, `img-${i}-${a.name.replace(/[^\w.-]/g, '_')}`);
        writeFileSync(file, a.bytes);
        args.push('-i', file);
      });
    }
    args.push('-'); // prompt on stdin

    const spawnImpl = this.opts.spawnImpl ?? spawn;
    const child = spawnImpl(this.opts.binaryPath, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrBuf = '';
    child.stderr?.on('data', (d: Buffer) => { stderrBuf += d.toString(); });

    const killChild = (): void => {
      if (child.exitCode !== null || child.killed) return;
      child.kill('SIGTERM');
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, SIGKILL_GRACE_MS);
      timer.unref();
    };
    const onAbort = (): void => killChild();
    if (signal.aborted) killChild();
    else signal.addEventListener('abort', onAbort, { once: true });

    const exited = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', () => resolve(null));
    });

    try {
      child.stdin?.end(renderConversation(req));

      let sawDone = false;
      if (child.stdout) {
        const rl = createInterface({ input: child.stdout });
        for await (const line of rl) {
          if (signal.aborted) return;
          const ev = parseCodexEvent(line);
          if (!ev) continue;
          if (ev.kind === 'text') yield { type: 'text', text: ev.text };
          else if (ev.kind === 'thinking') {
            if (req.thinking === true) yield { type: 'thinking', text: ev.text };
          } else if (ev.kind === 'done') {
            sawDone = true;
            yield { type: 'done', ...(ev.usage ? { usage: ev.usage } : {}) };
            return;
          } else {
            throw new Error(`Codex error: ${ev.message}`);
          }
        }
      }
      if (signal.aborted) return;
      const code = await exited;
      if (!sawDone) {
        if (code !== 0) {
          const tail = stderrBuf.trim().slice(-2000);
          throw new Error(
            `codex exec exited with code ${code ?? 'unknown'}${tail ? ` | stderr: ${tail}` : ''}`,
          );
        }
        // Stream ended cleanly without a turn.completed — still terminate the
        // dispatch loop, matching the other providers' safety net.
        yield { type: 'done' };
      }
    } catch (err) {
      if (stderrBuf.length > 0 && err instanceof Error && !err.message.includes('stderr:')) {
        throw new Error(`${err.message} | codex stderr: ${stderrBuf.trim().slice(-2000)}`);
      }
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
      killChild();
      if (token) this.opts.bridge.unregister(token);
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}
