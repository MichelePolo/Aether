import { runGit } from '@/server/domain/git/git.runner';

/** Validates a remote/branch/ref name. The charset excludes ':' so URLs are rejected. */
export function badRef(s: unknown): boolean {
  return typeof s !== 'string' || s.length === 0 || !/^[\w./][\w./-]*$/.test(s);
}

/** Lists the names of remotes configured in the repo (e.g. `origin`). */
export async function configuredRemotes(cwd: string): Promise<Set<string>> {
  try {
    const r = await runGit(['remote'], cwd);
    return new Set(r.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}
