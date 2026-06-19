import path from 'node:path';
import { normalizeRoot } from './normalize-root';

describe('normalizeRoot', () => {
  it('returns an absolute resolved path', () => {
    expect(normalizeRoot('.')).toBe(path.resolve('.'));
  });

  it('collapses . and .. segments', () => {
    expect(normalizeRoot('/a/b/../c')).toBe(path.resolve('/a/c'));
  });

  it('is idempotent', () => {
    const once = normalizeRoot('/a/b');
    expect(normalizeRoot(once)).toBe(once);
  });

  it('case-folds only on Windows', () => {
    const upper = normalizeRoot('/A/B');
    const lower = normalizeRoot('/a/b');
    if (process.platform === 'win32') {
      expect(upper).toBe(lower);
    } else {
      expect(upper).not.toBe(lower);
    }
  });
});
