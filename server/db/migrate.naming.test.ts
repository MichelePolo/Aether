import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Migration numbers are a shared sequential resource: two branches developed in
// parallel can independently pick the same next number (e.g. both `012_`), and
// the duplicate only surfaces when they land together — at which point one
// migration is silently skipped (the `_migrations` table keys on version). This
// guard fails fast in CI on any collision, gap, or malformed prefix.
describe('migration file naming', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  it('every migration has a NNN_ numeric prefix', () => {
    const bad = files.filter((f) => !/^\d{3}_.+\.sql$/.test(f));
    expect(bad).toEqual([]);
  });

  it('migration version prefixes are unique (no cross-branch collisions)', () => {
    const nums = files.map((f) => parseInt(f.slice(0, 3), 10));
    const duplicates = [...new Set(nums.filter((n, i) => nums.indexOf(n) !== i))];
    expect(duplicates).toEqual([]);
  });

  it('migration version prefixes are contiguous starting at 1', () => {
    const nums = [...new Set(files.map((f) => parseInt(f.slice(0, 3), 10)))].sort((a, b) => a - b);
    const expected = Array.from({ length: nums.length }, (_, i) => i + 1);
    expect(nums).toEqual(expected);
  });
});
