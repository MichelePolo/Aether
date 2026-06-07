import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  gitStatus, gitDiff, gitAdd, gitCommit, gitCheckout, gitRestore,
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
