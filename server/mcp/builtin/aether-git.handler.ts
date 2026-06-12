import { runGit } from '@/server/domain/git/git.runner';
import { GIT_REMOTE_DEFAULTS } from '@/server/domain/git/git.types';

export interface GitToolResult {
  isError: boolean;
  content: Array<{ type: 'text'; text: string }>;
}

function ok(stdout: string, stderr: string, code: number): GitToolResult {
  const text = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || `exit code: ${code}`;
  return { isError: code !== 0, content: [{ type: 'text', text }] };
}

function err(message: string): GitToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function badPath(p: unknown): boolean {
  return typeof p !== 'string' || p.length === 0 || p.startsWith('-');
}

/** Validates a remote/branch/ref name. The charset excludes ':' so URLs are rejected. */
function badRef(s: unknown): boolean {
  return typeof s !== 'string' || s.length === 0 || !/^[\w./-]+$/.test(s);
}

const REMOTE_ENV: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0' };

async function run(
  args: string[],
  cwd: string,
  opts?: { timeoutMs?: number; maxTimeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<GitToolResult> {
  try {
    const r = await runGit(args, cwd, opts);
    return ok(r.stdout, r.stderr, r.code);
  } catch (e) {
    return err(e instanceof Error ? e.message : 'git failed');
  }
}

function runRemote(args: string[], cwd: string): Promise<GitToolResult> {
  return run(args, cwd, {
    timeoutMs: GIT_REMOTE_DEFAULTS.timeoutMs,
    maxTimeoutMs: GIT_REMOTE_DEFAULTS.maxTimeoutMs,
    env: REMOTE_ENV,
  });
}

/** Lists the names of remotes configured in the repo (e.g. `origin`). */
async function configuredRemotes(cwd: string): Promise<Set<string>> {
  try {
    const r = await runGit(['remote'], cwd);
    return new Set(r.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function gitStatus(cwd: string): Promise<GitToolResult> {
  return run(['status', '--porcelain=v2', '--branch'], cwd);
}

export function gitDiff(args: { staged?: boolean; path?: string }, cwd: string): Promise<GitToolResult> {
  const a = ['diff'];
  if (args.staged) a.push('--cached');
  if (args.path !== undefined) {
    if (badPath(args.path)) return Promise.resolve(err('invalid path'));
    a.push('--', args.path);
  }
  return run(a, cwd);
}

export function gitAdd(args: { paths?: unknown }, cwd: string): Promise<GitToolResult> {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) return Promise.resolve(err('paths (non-empty string[]) required'));
  for (const p of paths) if (badPath(p)) return Promise.resolve(err(`invalid path: ${String(p)}`));
  return run(['add', '--', ...(paths as string[])], cwd);
}

export function gitCommit(args: { message?: unknown }, cwd: string): Promise<GitToolResult> {
  if (typeof args.message !== 'string' || args.message.trim().length === 0) {
    return Promise.resolve(err('message (non-empty string) required'));
  }
  return run(['commit', '-m', args.message], cwd);
}

export function gitCheckout(args: { branch?: unknown; create?: unknown }, cwd: string): Promise<GitToolResult> {
  if (typeof args.branch !== 'string' || args.branch.length === 0 || args.branch.startsWith('-')) {
    return Promise.resolve(err('branch (string) required'));
  }
  const a = ['checkout'];
  if (args.create === true) a.push('-b');
  a.push(args.branch);
  return run(a, cwd);
}

export function gitRestore(args: { paths?: unknown; staged?: unknown }, cwd: string): Promise<GitToolResult> {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) return Promise.resolve(err('paths (non-empty string[]) required'));
  for (const p of paths) if (badPath(p)) return Promise.resolve(err(`invalid path: ${String(p)}`));
  const a = ['restore'];
  if (args.staged === true) a.push('--staged');
  a.push('--', ...(paths as string[]));
  return run(a, cwd);
}

export async function gitFetch(args: { remote?: unknown }, cwd: string): Promise<GitToolResult> {
  const remote = args.remote ?? 'origin';
  if (badRef(remote)) return err('invalid remote');
  const remotes = await configuredRemotes(cwd);
  if (!remotes.has(remote as string)) return err(`unknown remote: ${String(remote)}`);
  return runRemote(['fetch', remote as string], cwd);
}

export async function gitPush(
  args: { remote?: unknown; branch?: unknown; setUpstream?: unknown },
  cwd: string,
): Promise<GitToolResult> {
  const remote = args.remote ?? 'origin';
  if (badRef(remote)) return err('invalid remote');
  if (args.branch !== undefined && badRef(args.branch)) {
    return err('invalid branch');
  }
  const remotes = await configuredRemotes(cwd);
  if (!remotes.has(remote as string)) return err(`unknown remote: ${String(remote)}`);

  let branch = args.branch as string | undefined;
  if (args.setUpstream === true && branch === undefined) {
    const cur = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    branch = cur.stdout.trim();
    if (!branch || branch === 'HEAD') return err('cannot set upstream for a detached HEAD');
  }

  const a = ['push'];
  if (args.setUpstream === true) a.push('-u');
  a.push(remote as string, branch ?? 'HEAD');
  return runRemote(a, cwd);
}

export async function gitPull(
  args: { remote?: unknown; branch?: unknown },
  cwd: string,
): Promise<GitToolResult> {
  const remote = args.remote ?? 'origin';
  if (badRef(remote)) return err('invalid remote');
  if (args.branch !== undefined && badRef(args.branch)) {
    return err('invalid branch');
  }
  const remotes = await configuredRemotes(cwd);
  if (!remotes.has(remote as string)) return err(`unknown remote: ${String(remote)}`);
  const a = ['pull', '--ff-only', remote as string];
  if (args.branch !== undefined) a.push(args.branch as string);
  return runRemote(a, cwd);
}

export function gitMerge(args: { ref?: unknown }, cwd: string): Promise<GitToolResult> {
  if (badRef(args.ref)) return Promise.resolve(err('ref (string) required'));
  return runRemote(['merge', '--ff-only', args.ref as string], cwd);
}
