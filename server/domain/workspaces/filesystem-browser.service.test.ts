import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesystemBrowserService } from './filesystem-browser.service';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aether-fsb-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('FilesystemBrowserService', () => {
  it('returns subdirectories sorted alphabetically', async () => {
    mkdirSync(join(dir, 'zebra'));
    mkdirSync(join(dir, 'alpha'));
    mkdirSync(join(dir, 'middle'));
    const svc = new FilesystemBrowserService();
    const r = await svc.browse(dir);
    expect(r.map((e) => e.name)).toEqual(['alpha', 'middle', 'zebra']);
    expect(r.every((e) => e.isDir)).toBe(true);
  });

  it('filters out files (only dirs returned)', async () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'file.txt'), 'x');
    const svc = new FilesystemBrowserService();
    const r = await svc.browse(dir);
    expect(r.map((e) => e.name)).toEqual(['sub']);
  });

  it('returns empty array on empty directory', async () => {
    const svc = new FilesystemBrowserService();
    expect(await svc.browse(dir)).toEqual([]);
  });

  it('throws on missing path', async () => {
    const svc = new FilesystemBrowserService();
    await expect(svc.browse(join(dir, 'nope'))).rejects.toThrow();
  });
});
