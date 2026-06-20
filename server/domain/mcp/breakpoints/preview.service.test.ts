import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PreviewService } from './preview.service';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aether-preview-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('PreviewService.previewToolCall', () => {
  it('write_file on existing file returns diff with old + new', async () => {
    const p = join(dir, 'a.txt');
    writeFileSync(p, 'hello\nworld\n');
    const svc = new PreviewService({ safeRoots: () => [dir], gitRoot: () => null });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { path: p, content: 'hello\nuniverse\n' },
    });
    expect(r.kind).toBe('diff');
    if (r.kind === 'diff') {
      expect(r.oldText).toBe('hello\nworld\n');
      expect(r.newText).toBe('hello\nuniverse\n');
      expect(r.path).toBe(p);
    }
  });

  it('write_file on missing file → diff with empty oldText', async () => {
    const p = join(dir, 'new.txt');
    const svc = new PreviewService({ safeRoots: () => [dir], gitRoot: () => null });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { path: p, content: 'fresh\n' },
    });
    expect(r.kind).toBe('diff');
    if (r.kind === 'diff') expect(r.oldText).toBe('');
  });

  it('edit_file on existing file returns diff', async () => {
    const p = join(dir, 'b.txt');
    writeFileSync(p, 'one\n');
    const svc = new PreviewService({ safeRoots: () => [dir], gitRoot: () => null });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.edit_file',
      args: { path: p, content: 'two\n' },
    });
    expect(r.kind).toBe('diff');
  });

  it('oversized file > 1 MB → plain', async () => {
    const p = join(dir, 'big.txt');
    writeFileSync(p, 'x'.repeat(1024 * 1024 + 1));
    const svc = new PreviewService({ safeRoots: () => [dir], gitRoot: () => null });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { path: p, content: 'small' },
    });
    expect(r.kind).toBe('plain');
  });

  it('non-write tool → plain', async () => {
    const svc = new PreviewService({ safeRoots: () => [dir], gitRoot: () => null });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.read_file',
      args: { path: join(dir, 'x.txt') },
    });
    expect(r.kind).toBe('plain');
  });

  it('missing args.path → plain', async () => {
    const svc = new PreviewService({ safeRoots: () => [dir], gitRoot: () => null });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { content: 'oops' },
    });
    expect(r.kind).toBe('plain');
  });

  it('path outside safeRoots → plain', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'aether-outside-'));
    const p = join(outside, 'evil.txt');
    writeFileSync(p, 'nope\n');
    const svc = new PreviewService({ safeRoots: () => [dir], gitRoot: () => null });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { path: p, content: 'x' },
    });
    expect(r.kind).toBe('plain');
    rmSync(outside, { recursive: true, force: true });
  });
});

const ENV = {
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@a.dev',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@a.dev',
};
function git(cwd: string, ...a: string[]) {
  execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, ...ENV } });
}
function repoWithStagedChange(): string {
  const repoDir = mkdtempSync(join(tmpdir(), 'aether-prev-'));
  git(repoDir, 'init', '-q');
  writeFileSync(join(repoDir, 'a.txt'), 'A1\n');
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-q', '-m', 'first');
  writeFileSync(join(repoDir, 'a.txt'), 'A2\n');
  git(repoDir, 'add', '.'); // staged change A1 -> A2
  return repoDir;
}

describe('PreviewService — git diff (slice 28)', () => {
  it('git_commit returns a gitDiff with staged content', async () => {
    const repo = repoWithStagedChange();
    try {
      const svc = new PreviewService({ safeRoots: () => [], gitRoot: () => repo });
      const r = await svc.previewToolCall({
        qualifiedName: 'Git.git_commit',
        args: { message: 'x' },
      });
      expect(r.kind).toBe('gitDiff');
      if (r.kind === 'gitDiff') {
        expect(r.unified).toMatch(/A2/);
        expect(r.title).toMatch(/Commit preview/);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('degrades to plain when no git root is set', async () => {
    const svc = new PreviewService({ safeRoots: () => [], gitRoot: () => null });
    const r = await svc.previewToolCall({ qualifiedName: 'Git.git_commit', args: {} });
    expect(r.kind).toBe('plain');
  });

  it('git_checkout is plain (not a file diff)', async () => {
    const svc = new PreviewService({ safeRoots: () => [], gitRoot: () => '/tmp' });
    const r = await svc.previewToolCall({
      qualifiedName: 'Git.git_checkout',
      args: { branch: 'x' },
    });
    expect(r.kind).toBe('plain');
  });
});

describe('PreviewService — explicit root overrides injected gitRoot (task 8)', () => {
  it('git_commit preview uses supplied root instead of injected gitRoot()', async () => {
    const defaultRepo = mkdtempSync(join(tmpdir(), 'aether-default-'));
    const workRepo = mkdtempSync(join(tmpdir(), 'aether-work-'));
    try {
      // Set up workRepo as a real git repo with a staged change
      const ENV_LOCAL = {
        GIT_AUTHOR_NAME: 'T',
        GIT_AUTHOR_EMAIL: 't@a.dev',
        GIT_COMMITTER_NAME: 'T',
        GIT_COMMITTER_EMAIL: 't@a.dev',
      };
      execFileSync('git', ['init', '-q'], { cwd: workRepo, stdio: 'pipe', env: { ...process.env, ...ENV_LOCAL } });
      writeFileSync(join(workRepo, 'x.txt'), 'A\n');
      execFileSync('git', ['add', '.'], { cwd: workRepo, stdio: 'pipe', env: { ...process.env, ...ENV_LOCAL } });
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: workRepo, stdio: 'pipe', env: { ...process.env, ...ENV_LOCAL } });
      writeFileSync(join(workRepo, 'x.txt'), 'B\n');
      execFileSync('git', ['add', '.'], { cwd: workRepo, stdio: 'pipe', env: { ...process.env, ...ENV_LOCAL } });

      // Construct preview with injected gitRoot pointing to defaultRepo (no staged changes there),
      // but invoke with explicit root = workRepo (has staged changes with content 'B').
      const svc = new PreviewService({ safeRoots: () => [], gitRoot: () => defaultRepo });
      const r = await svc.previewToolCall({
        qualifiedName: 'Git.git_commit',
        args: { message: 'wip' },
        root: workRepo,
      });
      // If the supplied root is used → gitDiff contains the staged change (A→B in workRepo).
      // If the injected gitRoot() were used → gitDiff would be empty (no staged changes in defaultRepo).
      expect(r.kind).toBe('gitDiff');
      if (r.kind === 'gitDiff') {
        expect(r.unified).toMatch(/B/); // staged content from workRepo, not present in defaultRepo
      }
    } finally {
      rmSync(defaultRepo, { recursive: true, force: true });
      rmSync(workRepo, { recursive: true, force: true });
    }
  });
});

describe('PreviewService — commitList for remote (slice 29)', () => {
  function repoWithOutgoing(): string {
    const bare = mkdtempSync(join(tmpdir(), 'aether-pbare-'));
    execFileSync('git', ['init', '--bare', '-q', bare], { stdio: 'pipe' });
    const work = mkdtempSync(join(tmpdir(), 'aether-pwork-'));
    git(work, 'init', '-q');
    git(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    writeFileSync(join(work, 'a.txt'), 'A1\n');
    git(work, 'add', '.'); git(work, 'commit', '-q', '-m', 'first');
    git(work, 'remote', 'add', 'origin', bare);
    git(work, 'push', '-q', '-u', 'origin', 'main');
    writeFileSync(join(work, 'b.txt'), 'B\n');
    git(work, 'add', '.'); git(work, 'commit', '-q', '-m', 'outgoing commit');
    return work; // origin/main is now 1 commit behind HEAD
  }

  it('git_push → commitList of outgoing commits', async () => {
    const work = repoWithOutgoing();
    try {
      const svc = new PreviewService({ safeRoots: () => [], gitRoot: () => work });
      const r = await svc.previewToolCall({ qualifiedName: 'Git.git_push', args: { remote: 'origin' } });
      expect(r.kind).toBe('commitList');
      if (r.kind === 'commitList') {
        expect(r.commits.length).toBe(1);
        expect(r.commits[0]).toMatch(/outgoing commit/);
        expect(r.title).toMatch(/origin\/main/);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('degrades to plain when there is no upstream', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aether-pnoup-'));
    git(dir, 'init', '-q');
    git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    writeFileSync(join(dir, 'a.txt'), 'A\n');
    git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'x');
    try {
      const svc = new PreviewService({ safeRoots: () => [], gitRoot: () => dir });
      const r = await svc.previewToolCall({ qualifiedName: 'Git.git_push', args: { remote: 'origin' } });
      expect(r.kind).toBe('plain');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
