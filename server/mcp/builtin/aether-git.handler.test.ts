import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  gitStatus, gitDiff, gitAdd, gitCommit, gitCheckout, gitRestore,
  gitFetch, gitPush, gitPull, gitMerge,
} from './aether-git.handler';

// Force English git output so message assertions are locale-independent.
// The handler spawns git via runGit using process.env, so set it process-wide.
process.env.LC_ALL = 'C';
process.env.LANG = 'C';

const ENV = {
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@a.dev',
  GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@a.dev',
};
function git(cwd: string, ...a: string[]) {
  execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, ...ENV } });
}
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aether-gitw-'));
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(join(dir, 'a.txt'), 'A1\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

describe('aether-git.handler', () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('git_status reports a clean branch', async () => {
    const r = await gitStatus(repo);
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toMatch(/branch\.head main/);
  });

  it('git_add then git_commit creates a commit', async () => {
    writeFileSync(join(repo, 'b.txt'), 'B\n');
    const add = await gitAdd({ paths: ['b.txt'] }, repo);
    expect(add.isError).toBe(false);
    const staged = await gitDiff({ staged: true }, repo);
    expect(staged.content[0].text).toMatch(/b\.txt/);
    const commit = await gitCommit({ message: 'add b' }, repo);
    expect(commit.isError).toBe(false);
    expect(execFileSync('git', ['log', '--oneline'], { cwd: repo }).toString()).toMatch(/add b/);
  });

  it('git_commit with nothing staged returns isError', async () => {
    const r = await gitCommit({ message: 'noop' }, repo);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/nothing to commit/i);
  });

  it('git_checkout create makes a new branch', async () => {
    const r = await gitCheckout({ branch: 'feature/x', create: true }, repo);
    expect(r.isError).toBe(false);
    expect(execFileSync('git', ['branch'], { cwd: repo }).toString()).toMatch(/feature\/x/);
  });

  it('git_restore discards an unstaged change', async () => {
    writeFileSync(join(repo, 'a.txt'), 'CHANGED\n');
    const r = await gitRestore({ paths: ['a.txt'] }, repo);
    expect(r.isError).toBe(false);
    expect(execFileSync('git', ['diff'], { cwd: repo }).toString()).toBe('');
  });

  it('rejects empty paths and path starting with dash', async () => {
    expect((await gitAdd({ paths: [] }, repo)).isError).toBe(true);
    expect((await gitAdd({ paths: ['-rf'] }, repo)).isError).toBe(true);
  });
});

function makeRepoWithRemote(): { work: string; bare: string } {
  const bare = mkdtempSync(join(tmpdir(), 'aether-bare-'));
  execFileSync('git', ['init', '--bare', '-q', bare], { stdio: 'pipe' });
  // Align the bare's default branch with the work repo's 'main' so that a
  // ref-less `git log` on the bare resolves correctly (host default may be master).
  execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { stdio: 'pipe' });
  const work = mkdtempSync(join(tmpdir(), 'aether-work-'));
  git(work, 'init', '-q');
  git(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(join(work, 'a.txt'), 'A1\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'first');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-q', '-u', 'origin', 'main');
  return { work, bare };
}

// Advance the bare remote's main by one commit, via a throwaway clone.
function advanceRemote(bare: string): void {
  const tmp = mkdtempSync(join(tmpdir(), 'aether-adv-'));
  execFileSync('git', ['clone', '-q', bare, tmp], { stdio: 'pipe' });
  writeFileSync(join(tmp, 'remote.txt'), 'R\n');
  git(tmp, 'add', '.');
  git(tmp, 'commit', '-q', '-m', 'remote commit');
  git(tmp, 'push', '-q', 'origin', 'HEAD:main');
  rmSync(tmp, { recursive: true, force: true });
}

describe('aether-git.handler — remote (slice 29)', () => {
  let work: string;
  let bare: string;
  beforeEach(() => { ({ work, bare } = makeRepoWithRemote()); });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  });

  it('git_push sends a new local commit to the bare remote', async () => {
    writeFileSync(join(work, 'b.txt'), 'B\n');
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'second');
    const r = await gitPush({ remote: 'origin' }, work);
    expect(r.isError).toBe(false);
    const remoteLog = execFileSync('git', ['-C', bare, 'log', '--oneline'], { stdio: 'pipe' }).toString();
    expect(remoteLog).toMatch(/second/);
  });

  it('git_fetch updates the remote-tracking ref without error', async () => {
    advanceRemote(bare);
    const r = await gitFetch({ remote: 'origin' }, work);
    expect(r.isError).toBe(false);
    // origin/main is now resolvable and ahead of local main.
    expect(() => execFileSync('git', ['-C', work, 'rev-parse', 'origin/main'], { stdio: 'pipe' })).not.toThrow();
  });

  it('git_pull --ff-only fast-forwards when the remote is ahead', async () => {
    advanceRemote(bare);
    const r = await gitPull({ remote: 'origin', branch: 'main' }, work);
    expect(r.isError).toBe(false);
    expect(execFileSync('git', ['-C', work, 'log', '--oneline'], { stdio: 'pipe' }).toString()).toMatch(/remote commit/);
  });

  it('git_pull --ff-only fails (isError) on a diverged branch', async () => {
    advanceRemote(bare);                 // remote has a new commit
    writeFileSync(join(work, 'c.txt'), 'C\n');
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'local commit'); // local also diverged
    const r = await gitPull({ remote: 'origin', branch: 'main' }, work);
    expect(r.isError).toBe(true);
  });

  it('git_merge --ff-only fast-forwards an ahead branch', async () => {
    git(work, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(work, 'f.txt'), 'F\n');
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'feature commit');
    git(work, 'checkout', '-q', 'main');
    const r = await gitMerge({ ref: 'feature' }, work);
    expect(r.isError).toBe(false);
    expect(execFileSync('git', ['-C', work, 'log', '--oneline'], { stdio: 'pipe' }).toString()).toMatch(/feature commit/);
  });

  it('rejects a remote that is a URL or starts with dash', async () => {
    expect((await gitFetch({ remote: 'https://evil.example/x' }, work)).isError).toBe(true);
    expect((await gitFetch({ remote: '--upload-pack=x' }, work)).isError).toBe(true);
  });
});

describe('aether-git.handler — remote target safety (slice 29 fix)', () => {
  let work: string;
  let bare: string;
  beforeEach(() => { ({ work, bare } = makeRepoWithRemote()); });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  });

  it('rejects an absolute filesystem path as a push remote', async () => {
    const evil = mkdtempSync(join(tmpdir(), 'aether-evil-'));
    execFileSync('git', ['init', '--bare', '-q', evil], { stdio: 'pipe' });
    try {
      const r = await gitPush({ remote: evil }, work);
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/unknown remote|invalid remote/i);
      // and nothing was pushed to the evil path (empty bare repo → no commits)
      let log = '';
      try {
        log = execFileSync('git', ['-C', evil, 'log', '--oneline'], { stdio: 'pipe' }).toString().trim();
      } catch {
        log = ''; // `git log` exits non-zero on a repo with no commits — that's the expected state
      }
      expect(log).toBe('');
    } finally {
      rmSync(evil, { recursive: true, force: true });
    }
  });

  it('rejects a relative path / unconfigured name as a fetch remote', async () => {
    expect((await gitFetch({ remote: '../evil' }, work)).isError).toBe(true);
    expect((await gitFetch({ remote: 'not-a-remote' }, work)).isError).toBe(true);
  });

  it('still allows the configured origin remote', async () => {
    writeFileSync(join(work, 'z.txt'), 'Z\n');
    git(work, 'add', '.'); git(work, 'commit', '-q', '-m', 'z');
    const r = await gitPush({ remote: 'origin' }, work);
    expect(r.isError).toBe(false);
  });
});
