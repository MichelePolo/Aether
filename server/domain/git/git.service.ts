import { parseLog, parseStatusPorcelain } from '@/src/lib/git-swimlanes';
import { NotFoundError, ValidationError } from '@/server/lib/errors';
import type { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import { runGit } from '@/server/domain/git/git.runner';
import { badRef, configuredRemotes } from '@/server/domain/git/remote-guard';
import { GIT_REMOTE_DEFAULTS } from '@/server/domain/git/git.types';
import type { CommitNode, DiffResult, GitStatus } from '@/server/domain/git/git.types';
import type { WorkingChanges } from '@/src/lib/git-swimlanes';

const HASH_RE = /^[0-9a-f]{7,40}$/;

export class GitService {
  constructor(private readonly workspaces: WorkspacesStore) {}

  private resolveCwd(workspaceId: string): string {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) throw new NotFoundError('workspace ' + workspaceId);
    return ws.rootPath;
  }

  async status(workspaceId: string): Promise<GitStatus> {
    const cwd = this.resolveCwd(workspaceId);

    const inside = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
    if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
      return { isRepo: false };
    }

    const result: GitStatus = { isRepo: true };

    // Best-effort: HEAD short hash (may fail on an empty repo with no commits).
    const head = await runGit(['rev-parse', '--short', 'HEAD'], cwd);
    if (head.code === 0) result.head = head.stdout.trim();

    const root = await runGit(['rev-parse', '--show-toplevel'], cwd);
    if (root.code === 0) result.root = root.stdout.trim();

    return result;
  }

  async log(
    workspaceId: string,
    opts?: { maxCount?: number },
  ): Promise<{ commits: CommitNode[]; truncated: boolean }> {
    const cwd = this.resolveCwd(workspaceId);
    const maxCount = opts?.maxCount ?? 500;

    const { stdout } = await runGit(
      [
        'log',
        '--all',
        '--date-order',
        '--name-status',
        '--pretty=format:%H|%P|%D|%an|%ad|%s',
        '--date=short',
        '--max-count=' + maxCount,
      ],
      cwd,
    );

    const { commits } = parseLog(stdout);
    return { commits, truncated: commits.length >= maxCount };
  }

  async diff(
    workspaceId: string,
    req: { hash: string; path: string; oldPath?: string },
  ): Promise<DiffResult> {
    const cwd = this.resolveCwd(workspaceId);

    if (!HASH_RE.test(req.hash)) throw new ValidationError('invalid commit hash');
    if (req.path.startsWith('-') || (req.oldPath && req.oldPath.startsWith('-'))) {
      throw new ValidationError('invalid path');
    }

    const args = req.oldPath
      ? ['show', '-M', req.hash, '--', req.oldPath, req.path]
      : ['show', req.hash, '--', req.path];

    const { stdout } = await runGit(args, cwd);
    return { unified: stdout };
  }

  private assertPaths(paths: unknown): asserts paths is string[] {
    if (!Array.isArray(paths) || paths.length === 0) throw new ValidationError('paths required');
    for (const p of paths) {
      if (typeof p !== 'string' || p.length === 0 || p.startsWith('-')) {
        throw new ValidationError('invalid path');
      }
    }
  }

  async changes(workspaceId: string): Promise<WorkingChanges> {
    const cwd = this.resolveCwd(workspaceId);
    const { stdout } = await runGit(['status', '--porcelain=v2', '--branch'], cwd);
    return parseStatusPorcelain(stdout);
  }

  async workingDiff(
    workspaceId: string,
    req: { path: string; staged?: boolean },
  ): Promise<DiffResult> {
    const cwd = this.resolveCwd(workspaceId);
    if (typeof req.path !== 'string' || req.path.length === 0 || req.path.startsWith('-')) {
      throw new ValidationError('invalid path');
    }
    const args = ['diff', ...(req.staged ? ['--cached'] : []), '--', req.path];
    const { stdout } = await runGit(args, cwd);
    return { unified: stdout };
  }

  async stage(workspaceId: string, req: { paths: unknown }): Promise<void> {
    const cwd = this.resolveCwd(workspaceId);
    this.assertPaths(req.paths);
    await runGit(['add', '--', ...req.paths], cwd);
  }

  async unstage(workspaceId: string, req: { paths: unknown }): Promise<void> {
    const cwd = this.resolveCwd(workspaceId);
    this.assertPaths(req.paths);
    await runGit(['restore', '--staged', '--', ...req.paths], cwd);
  }

  async discard(workspaceId: string, req: { paths: unknown }): Promise<void> {
    const cwd = this.resolveCwd(workspaceId);
    this.assertPaths(req.paths);
    await runGit(['restore', '--', ...req.paths], cwd);
  }

  async commit(workspaceId: string, req: { message: unknown }): Promise<{ head: string }> {
    const cwd = this.resolveCwd(workspaceId);
    if (typeof req.message !== 'string' || req.message.trim().length === 0) {
      throw new ValidationError('commit message required');
    }
    const r = await runGit(['commit', '-m', req.message], cwd);
    if (r.code !== 0) {
      throw new ValidationError(r.stderr.trim() || r.stdout.trim() || 'commit failed');
    }
    const head = await runGit(['rev-parse', '--short', 'HEAD'], cwd);
    return { head: head.stdout.trim() };
  }

  async push(
    workspaceId: string,
    req: { remote?: string; branch?: string },
  ): Promise<{ stdout: string }> {
    const cwd = this.resolveCwd(workspaceId);
    const remote = req.remote ?? 'origin';
    if (badRef(remote)) throw new ValidationError('invalid remote');
    if (req.branch !== undefined && badRef(req.branch)) throw new ValidationError('invalid branch');
    const remotes = await configuredRemotes(cwd);
    if (!remotes.has(remote)) throw new ValidationError(`unknown remote: ${remote}`);
    const r = await runGit(['push', remote, req.branch ?? 'HEAD'], cwd, {
      timeoutMs: GIT_REMOTE_DEFAULTS.timeoutMs,
      maxTimeoutMs: GIT_REMOTE_DEFAULTS.maxTimeoutMs,
      env: { GIT_TERMINAL_PROMPT: '0' },
    });
    if (r.code !== 0) throw new ValidationError(r.stderr.trim() || r.stdout.trim() || 'push failed');
    return { stdout: [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n') };
  }
}
