import { parseLog } from '@/src/lib/git-swimlanes';
import { NotFoundError, ValidationError } from '@/server/lib/errors';
import type { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import { runGit } from '@/server/domain/git/git.runner';
import type { CommitNode, DiffResult, GitStatus } from '@/server/domain/git/git.types';

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
}
