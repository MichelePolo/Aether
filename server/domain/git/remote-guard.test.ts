import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { badRef, configuredRemotes } from './remote-guard';

describe('remote-guard', () => {
  it('badRef rejects URLs, dashes, empty, and non-strings', () => {
    expect(badRef('origin')).toBe(false);
    expect(badRef('feature/x')).toBe(false);
    expect(badRef('https://evil/x')).toBe(true);
    expect(badRef('git@host:x')).toBe(true);
    expect(badRef('-x')).toBe(true);
    expect(badRef('')).toBe(true);
    expect(badRef(42)).toBe(true);
  });

  it('configuredRemotes lists the repo remotes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aether-rg-'));
    try {
      execFileSync('git', ['init', '-q', dir], { stdio: 'pipe' });
      execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', '/tmp/x'], { stdio: 'pipe' });
      return configuredRemotes(dir).then((set) => {
        expect(set.has('origin')).toBe(true);
        expect(set.has('upstream')).toBe(false);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
