import { spawn } from 'node:child_process';
import { BLOCKED_PATTERNS, SHELL_DEFAULTS } from '@/server/domain/mcp/builtin/builtin.types';

export interface ExecuteCommandInput {
  cmd: string;
  cwd?: string;
  timeout?: number;
  signal?: AbortSignal;
}

export interface ExecuteCommandResult {
  isError: boolean;
  exitCode?: number;
  signal?: string | null;
  timedOut?: boolean;
  content: Array<{ type: 'text'; text: string }>;
}

const TRUNC_MARKER = '\n[output truncated]';

function formatOutput(stdout: string, stderr: string, exit: string): string {
  return `${stdout}\n---\n${stderr}\n---\n${exit}`;
}

function findBlockedPattern(cmd: string): RegExp | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) return pattern;
  }
  return null;
}

export async function executeCommand(input: ExecuteCommandInput): Promise<ExecuteCommandResult> {
  if (input.signal?.aborted) return { isError: true, exitCode: 130, content: [{ type: 'text', text: 'Command cancelled' }] };
  const blocked = findBlockedPattern(input.cmd);
  if (blocked) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `blocked by safety policy: ${blocked.source}`,
        },
      ],
    };
  }

  const requestedTimeout = input.timeout ?? SHELL_DEFAULTS.timeoutMs;
  const effectiveTimeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, SHELL_DEFAULTS.maxTimeoutMs) : SHELL_DEFAULTS.timeoutMs;
  const cwd = input.cwd ?? process.cwd();

  return new Promise<ExecuteCommandResult>((resolve) => {
    const child = spawn(input.cmd, [], { shell: true, cwd, windowsHide: true, detached: process.platform !== 'win32' });
    let stdoutBuf = '';
    let stderrBuf = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const cap = SHELL_DEFAULTS.outputCapBytes;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return;
      stdoutBuf += chunk.toString('utf-8');
      if (stdoutBuf.length >= cap) {
        stdoutBuf = stdoutBuf.slice(0, cap);
        stdoutTruncated = true;
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrTruncated) return;
      stderrBuf += chunk.toString('utf-8');
      if (stderrBuf.length >= cap) {
        stderrBuf = stderrBuf.slice(0, cap);
        stderrTruncated = true;
      }
    });

    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const killTree = () => {
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      } else if (child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        killer.on('error', () => child.kill('SIGKILL'));
      } else { child.kill('SIGKILL'); }
    };
    const abort = () => { cancelled = true; killTree(); };
    const timer = setTimeout(() => { timedOut = true; killTree(); }, effectiveTimeout);
    const finish = (result: ExecuteCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) abort();

    child.on('error', (err) => finish({
      isError: true, exitCode: 1,
      content: [{ type: 'text', text: `spawn error: ${err.message}` }],
    }));
    // close follows stdio drainage; exit may fire before the last output chunk.
    child.on('close', (code, signal: string | null) => {
      const exitCode = timedOut ? 124 : cancelled ? 130 : (code ?? 1);
      const stdoutOut = stdoutTruncated ? stdoutBuf + TRUNC_MARKER : stdoutBuf;
      const stderrOut = stderrTruncated ? stderrBuf + TRUNC_MARKER : stderrBuf;
      const reason = timedOut ? `timeout after ${effectiveTimeout}ms` : cancelled ? 'cancelled' : signal ? `signal: ${signal}` : '';
      finish({
        isError: exitCode !== 0, exitCode, signal, timedOut,
        content: [{ type: 'text', text: formatOutput(stdoutOut, stderrOut, `${reason ? reason + '\n' : ''}exit code: ${exitCode}`) }],
      });
    });
  });
}
