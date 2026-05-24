import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    const svc = new PreviewService({ safeRoots: () => [dir] });
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
    const svc = new PreviewService({ safeRoots: () => [dir] });
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
    const svc = new PreviewService({ safeRoots: () => [dir] });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.edit_file',
      args: { path: p, content: 'two\n' },
    });
    expect(r.kind).toBe('diff');
  });

  it('oversized file > 1 MB → plain', async () => {
    const p = join(dir, 'big.txt');
    writeFileSync(p, 'x'.repeat(1024 * 1024 + 1));
    const svc = new PreviewService({ safeRoots: () => [dir] });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { path: p, content: 'small' },
    });
    expect(r.kind).toBe('plain');
  });

  it('non-write tool → plain', async () => {
    const svc = new PreviewService({ safeRoots: () => [dir] });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.read_file',
      args: { path: join(dir, 'x.txt') },
    });
    expect(r.kind).toBe('plain');
  });

  it('missing args.path → plain', async () => {
    const svc = new PreviewService({ safeRoots: () => [dir] });
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
    const svc = new PreviewService({ safeRoots: () => [dir] });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { path: p, content: 'x' },
    });
    expect(r.kind).toBe('plain');
    rmSync(outside, { recursive: true, force: true });
  });
});
