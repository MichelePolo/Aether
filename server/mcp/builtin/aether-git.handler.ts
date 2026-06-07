import { runGit } from '@/server/domain/git/git.runner';

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

async function run(args: string[], cwd: string): Promise<GitToolResult> {
  try {
    const r = await runGit(args, cwd);
    return ok(r.stdout, r.stderr, r.code);
  } catch (e) {
    return err(e instanceof Error ? e.message : 'git failed');
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
