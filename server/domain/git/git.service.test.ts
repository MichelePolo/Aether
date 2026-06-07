import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignLanes } from '@/src/lib/git-swimlanes';
import type { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import { GitService } from '@/server/domain/git/git.service';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    },
  });
}

let repoDir: string;
let emptyDir: string;
let service: GitService;

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'git-svc-repo-'));
  emptyDir = mkdtempSync(join(tmpdir(), 'git-svc-empty-'));

  // 1. init + identity + deterministic branch name `main`.
  git(['init', '-q'], repoDir);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  git(['config', 'user.name', 'Test User'], repoDir);
  git(['config', 'commit.gpgsign', 'false'], repoDir);

  // 2. first commit on main.
  writeFileSync(join(repoDir, 'a.txt'), 'A1\n');
  git(['add', 'a.txt'], repoDir);
  git(['commit', '-q', '-m', 'A1'], repoDir);

  // 3. feature branch with two commits.
  git(['checkout', '-q', '-b', 'feature/login'], repoDir);
  writeFileSync(join(repoDir, 'login.txt'), 'login v1\n');
  git(['add', 'login.txt'], repoDir);
  git(['commit', '-q', '-m', 'add login'], repoDir);
  writeFileSync(join(repoDir, 'login.txt'), 'login v2\n');
  git(['add', 'login.txt'], repoDir);
  git(['commit', '-q', '-m', 'tweak login'], repoDir);

  // 4. merge --no-ff back to main.
  git(['checkout', '-q', 'main'], repoDir);
  git(['merge', '--no-ff', 'feature/login', '-m', 'Merge pull request #7 from feature/login'], repoDir);

  // 5. tag.
  git(['tag', 'v1'], repoDir);

  // 6. one more commit on main.
  writeFileSync(join(repoDir, 'a.txt'), 'A2\n');
  git(['add', 'a.txt'], repoDir);
  git(['commit', '-q', '-m', 'A2'], repoDir);

  const store = {
    get: (id: string) =>
      id === 'ws1'
        ? { id, name: 'r', rootPath: repoDir, addedAt: 0 }
        : id === 'wsEmpty'
          ? { id, name: 'e', rootPath: emptyDir, addedAt: 0 }
          : undefined,
  } as unknown as WorkspacesStore;

  service = new GitService(store);
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(emptyDir, { recursive: true, force: true });
});

describe('GitService.status', () => {
  it('reports a repo with head and root', async () => {
    const st = await service.status('ws1');
    expect(st.isRepo).toBe(true);
    expect(typeof st.head).toBe('string');
    expect((st.head ?? '').length).toBeGreaterThanOrEqual(7);
    expect(realpathSync(st.root ?? '')).toBe(realpathSync(repoDir));
  });

  it('reports a non-repo directory', async () => {
    const st = await service.status('wsEmpty');
    expect(st).toEqual({ isRepo: false });
  });

  it('rejects a missing workspace with NotFoundError (404)', async () => {
    await expect(service.status('missing')).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
    });
  });
});

describe('GitService.log', () => {
  it('returns commits newest-first with merge, branch ref and tag', async () => {
    const { commits, truncated } = await service.log('ws1');
    expect(commits.length).toBeGreaterThanOrEqual(5);
    expect(truncated).toBe(false);

    const merge = commits.find((c) => c.subject.includes('Merge pull request #7'));
    expect(merge).toBeDefined();
    expect(merge?.parents.length).toBe(2);

    // newest-first: the newest 'A2' commit (a child) precedes the older 'A1'.
    const a2 = commits.findIndex((c) => c.subject === 'A2');
    const a1 = commits.findIndex((c) => c.subject === 'A1');
    expect(a2).toBeGreaterThanOrEqual(0);
    expect(a1).toBeGreaterThan(a2);

    const hasMain = commits.some((c) => c.branches.includes('main'));
    expect(hasMain).toBe(true);

    const hasTag = commits.some((c) => c.tags.includes('v1'));
    expect(hasTag).toBe(true);
  });

  it('truncates when maxCount is hit', async () => {
    const { commits, truncated } = await service.log('ws1', { maxCount: 2 });
    expect(commits.length).toBe(2);
    expect(truncated).toBe(true);
  });

  it('produces lanes that include main (lane 0) and feature/login', async () => {
    const { commits } = await service.log('ws1');
    const byHash = Object.fromEntries(commits.map((c) => [c.hash, c]));
    const lanes = assignLanes(commits, byHash);
    expect(lanes.laneNames).toContain('main');
    expect(lanes.laneNames).toContain('feature/login');
    expect(lanes.laneNames[0]).toBe('main');
  });
});

describe('GitService.diff', () => {
  it('returns a non-empty unified diff for a real commit', async () => {
    const { commits } = await service.log('ws1');
    const touched = commits.find((c) => c.files.some((f) => f.path === 'a.txt'));
    expect(touched).toBeDefined();
    const hash = (touched as { hash: string }).hash.slice(0, 12);

    const { unified } = await service.diff('ws1', { hash, path: 'a.txt' });
    expect(unified.length).toBeGreaterThan(0);
    expect(/a\.txt|@@|^[+-]/m.test(unified)).toBe(true);
  });

  it('rejects an invalid hash with ValidationError', async () => {
    await expect(service.diff('ws1', { hash: 'zzz', path: 'a.txt' })).rejects.toMatchObject({
      name: 'ValidationError',
      status: 400,
    });
  });

  it('rejects a path starting with - with ValidationError', async () => {
    await expect(service.diff('ws1', { hash: 'abcdef0', path: '-rf' })).rejects.toMatchObject({
      name: 'ValidationError',
      status: 400,
    });
  });
});
