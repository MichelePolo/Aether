import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { AppError } from '@/server/lib/errors';
import { SHELL_DEFAULTS } from '@/server/domain/mcp/builtin/builtin.types';
import { GIT_DEFAULTS, type GitRunResult } from '@/server/domain/git/git.types';

/** Git subcommands the runner is allowed to invoke. */
export const GIT_SUBCOMMANDS = new Set([
  // read (slice 27)
  'log', 'show', 'rev-parse', 'status', 'diff',
  // write (slice 28)
  'add', 'commit', 'checkout', 'switch', 'restore',
  // remote (slice 29)
  'fetch', 'push', 'pull', 'merge', 'remote',
]);

/** Fixed flags prepended to every invocation. */
const FIXED_FLAGS = ['-c', 'core.quotepath=false', '--no-pager'];

const TRUNC_MARKER = '\n[output truncated]';

export class GitError extends AppError {
  constructor(message: string, options: { status?: number; code?: string; cause?: unknown } = {}) {
    super(message, {
      status: options.status ?? 500,
      code: options.code ?? 'GIT_ERROR',
      cause: options.cause,
    });
    this.name = 'GitError';
  }
}

function isValidCwd(cwd: string): boolean {
  try {
    return existsSync(cwd) && statSync(cwd).isDirectory();
  } catch {
    return false;
  }
}

export async function runGit(
  args: string[],
  cwd: string,
  opts?: { timeoutMs?: number; maxTimeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<GitRunResult> {
  // Allowlist check — reject BEFORE spawning.
  const subcommand = args[0];
  if (!subcommand || !GIT_SUBCOMMANDS.has(subcommand)) {
    throw new GitError(`unsupported git subcommand: ${subcommand ?? ''}`, {
      status: 400,
      code: 'GIT_SUBCOMMAND',
    });
  }

  // cwd validation — reject BEFORE spawning.
  if (!isValidCwd(cwd)) {
    throw new GitError('invalid cwd', { status: 400 });
  }

  const effectiveTimeout = Math.min(
    opts?.timeoutMs ?? GIT_DEFAULTS.timeoutMs,
    opts?.maxTimeoutMs ?? GIT_DEFAULTS.maxTimeoutMs,
  );
  const cap = SHELL_DEFAULTS.outputCapBytes;

  return new Promise<GitRunResult>((resolve, reject) => {
    const child = spawn('git', [...FIXED_FLAGS, ...args], {
      cwd,
      shell: false,
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;

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
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 500);
      reject(
        new GitError(`git timed out after ${effectiveTimeout}ms`, {
          status: 504,
          code: 'GIT_TIMEOUT',
        }),
      );
    }, effectiveTimeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new GitError(`git spawn failed: ${err.message}`, { status: 500, cause: err }));
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const stdout = stdoutTruncated ? stdoutBuf + TRUNC_MARKER : stdoutBuf;
      const stderr = stderrTruncated ? stderrBuf + TRUNC_MARKER : stderrBuf;
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}
