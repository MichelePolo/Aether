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
