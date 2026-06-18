import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readProjectMemory, ETERE_FILENAME, PROJECT_MEMORY_CAP_BYTES } from './project-memory';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'etere-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readProjectMemory', () => {
  it('returns null when root is null', () => {
    expect(readProjectMemory(null)).toBeNull();
  });

  it('returns null when ETERE.md is absent', () => {
    expect(readProjectMemory(root)).toBeNull();
  });

  it('returns null when ETERE.md is empty/whitespace', () => {
    writeFileSync(path.join(root, ETERE_FILENAME), '   \n\t');
    expect(readProjectMemory(root)).toBeNull();
  });

  it('returns the file content verbatim when under the cap', () => {
    const content = '# ETERE.md — demo\n\nProject notes.';
    writeFileSync(path.join(root, ETERE_FILENAME), content);
    expect(readProjectMemory(root)).toBe(content);
  });

  it('returns null when root path is a directory without the file', () => {
    mkdirSync(path.join(root, 'sub'));
    expect(readProjectMemory(path.join(root, 'sub'))).toBeNull();
  });

  it('truncates with a notice when over the cap', () => {
    const big = 'x'.repeat(PROJECT_MEMORY_CAP_BYTES + 5000);
    writeFileSync(path.join(root, ETERE_FILENAME), big);
    const out = readProjectMemory(root)!;
    expect(out).not.toBeNull();
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain('truncated');
    expect(out).toContain(String(PROJECT_MEMORY_CAP_BYTES));
  });
});
