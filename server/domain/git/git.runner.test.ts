import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runGit, GitError } from '@/server/domain/git/git.runner';

// Force deterministic English git output (the host locale may differ).
process.env.LC_ALL = 'C';

const tempDirs: string[] = [];

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aether-git-'));
  tempDirs.push(dir);
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@aether.dev');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-q', '-m', 'first');
  return dir;
}

function makeNonRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aether-nogit-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('runGit', () => {
  it('rejects a subcommand not in the allowlist (status 400)', async () => {
    const repo = makeRepo();
    await expect(runGit(['clone'], repo)).rejects.toBeInstanceOf(GitError);
    await expect(runGit(['clone'], repo)).rejects.toMatchObject({ status: 400 });
  });

  it('runs log and returns stdout/code', async () => {
    const repo = makeRepo();
    const result = await runGit(['log', '--oneline'], repo);
    expect(result.stdout).toContain('first');
    expect(result.code).toBe(0);
  });

  it('reports inside a work tree for a real repo', async () => {
    const repo = makeRepo();
    const result = await runGit(['rev-parse', '--is-inside-work-tree'], repo);
    expect(result.stdout.trim()).toBe('true');
    expect(result.code).toBe(0);
  });

  it('resolves with a non-zero code outside a repo (does not reject)', async () => {
    const nonRepo = makeNonRepo();
    const result = await runGit(['rev-parse', '--is-inside-work-tree'], nonRepo);
    expect(result.code).not.toBe(0);
  });

  it('rejects an invalid cwd (status 400)', async () => {
    await expect(runGit(['log'], '/no/such/dir/xyz')).rejects.toBeInstanceOf(GitError);
    await expect(runGit(['log'], '/no/such/dir/xyz')).rejects.toMatchObject({ status: 400 });
  });
});

describe('runGit — write subcommand allowlist (slice 28)', () => {
  it('permits write subcommands (does not reject as unsupported)', async () => {
    const repo = makeRepo(); // existing helper in this file
    try {
      // 'status' is now allowlisted: resolves instead of throwing GIT_SUBCOMMAND.
      const r = await runGit(['status', '--porcelain=v2'], repo);
      expect(r.code).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('still rejects a non-allowlisted subcommand', async () => {
    const repo = makeRepo();
    try {
      await expect(runGit(['clone', 'x'], repo)).rejects.toThrow(/unsupported git subcommand/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('runGit — remote subcommands (slice 29)', () => {
  it('permits merge (allowlisted) — merging HEAD is a no-op', async () => {
    const repo = makeRepo();
    try {
      const r = await runGit(['merge', '--ff-only', 'HEAD'], repo);
      expect(r.code).toBe(0);
      expect(r.stdout + r.stderr).toMatch(/up to date/i);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('permits fetch/push/pull as subcommands (not rejected by allowlist)', async () => {
    const repo = makeRepo();
    try {
      // No remote configured, so these exit non-zero — but they must NOT throw
      // the GIT_SUBCOMMAND allowlist error (which would reject before spawn).
      for (const sub of ['fetch', 'push', 'pull']) {
        await expect(runGit([sub], repo)).resolves.toBeDefined();
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
