import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { moveDirSync } from './move-dir';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'move-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeDir(p: string): void {
  mkdirSync(p, { recursive: true });
  writeFileSync(path.join(p, 'SKILL.md'), 'hello');
  mkdirSync(path.join(p, 'resources'), { recursive: true });
  writeFileSync(path.join(p, 'resources', 'r.txt'), 'res');
}

function errno(code: string): () => never {
  return () => {
    const e: NodeJS.ErrnoException = new Error(code);
    e.code = code;
    throw e;
  };
}

describe('moveDirSync', () => {
  it('moves a directory (including nested files) via rename', () => {
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    makeDir(src);
    moveDirSync(src, dest);
    expect(existsSync(src)).toBe(false);
    expect(readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toBe('hello');
    expect(readFileSync(path.join(dest, 'resources', 'r.txt'), 'utf8')).toBe('res');
  });

  it('falls back to copy+remove when rename throws EPERM (Windows lock)', () => {
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    makeDir(src);
    moveDirSync(src, dest, errno('EPERM'));
    expect(existsSync(src)).toBe(false);
    expect(readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toBe('hello');
    expect(readFileSync(path.join(dest, 'resources', 'r.txt'), 'utf8')).toBe('res');
  });

  it('falls back to copy+remove on EXDEV (cross-device)', () => {
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    makeDir(src);
    moveDirSync(src, dest, errno('EXDEV'));
    expect(existsSync(src)).toBe(false);
    expect(existsSync(path.join(dest, 'SKILL.md'))).toBe(true);
  });

  it('rethrows errors that are not lock/cross-device related (e.g. ENOENT)', () => {
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    makeDir(src);
    expect(() => moveDirSync(src, dest, errno('ENOENT'))).toThrow(/ENOENT/);
    expect(existsSync(src)).toBe(true);
    expect(existsSync(dest)).toBe(false);
  });
});
