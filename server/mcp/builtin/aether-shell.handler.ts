import { spawn } from 'node:child_process';
import { BLOCKED_PATTERNS, SHELL_DEFAULTS } from '@/server/domain/mcp/builtin/builtin.types';

export interface ExecuteCommandInput {
  cmd: string;
  cwd?: string;
  timeout?: number;
}

export interface ExecuteCommandResult {
  isError: boolean;
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
  const effectiveTimeout = Math.min(requestedTimeout, SHELL_DEFAULTS.maxTimeoutMs);
  const cwd = input.cwd ?? process.cwd();

  return new Promise<ExecuteCommandResult>((resolve) => {
    const child = spawn(input.cmd, [], { shell: true, cwd });
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

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 500);
      const stdoutOut = stdoutTruncated ? stdoutBuf + TRUNC_MARKER : stdoutBuf;
      const stderrOut = stderrTruncated ? stderrBuf + TRUNC_MARKER : stderrBuf;
      resolve({
        isError: true,
        content: [
          {
            type: 'text',
            text: formatOutput(stdoutOut, stderrOut, `timeout after ${effectiveTimeout}ms`),
          },
        ],
      });
    }, effectiveTimeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        isError: true,
        content: [{ type: 'text', text: `spawn error: ${err.message}` }],
      });
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      const stdoutOut = stdoutTruncated ? stdoutBuf + TRUNC_MARKER : stdoutBuf;
      const stderrOut = stderrTruncated ? stderrBuf + TRUNC_MARKER : stderrBuf;
      const exitCode = code ?? 0;
      resolve({
        isError: exitCode !== 0,
        content: [
          {
            type: 'text',
            text: formatOutput(stdoutOut, stderrOut, `exit code: ${exitCode}`),
          },
        ],
      });
    });
  });
}
