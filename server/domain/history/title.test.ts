import { describe, it, expect } from 'vitest';
import { computeTitle } from './title';

describe('computeTitle (server)', () => {
  it('returns "Nuova sessione" for empty input', () => {
    expect(computeTitle('')).toBe('Nuova sessione');
    expect(computeTitle('   ')).toBe('Nuova sessione');
  });

  it('returns text as-is when short', () => {
    expect(computeTitle('hello')).toBe('hello');
    expect(computeTitle('hi there')).toBe('hi there');
  });

  it('truncates to 40 chars with ellipsis', () => {
    const long = 'a'.repeat(60);
    const out = computeTitle(long);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out.endsWith('…')).toBe(true);
  });

  it('collapses whitespace', () => {
    expect(computeTitle('foo   bar\n\nbaz')).toBe('foo bar baz');
  });

  it('trims trailing whitespace before ellipsis', () => {
    const input = 'a'.repeat(38) + '  bcdef';
    const out = computeTitle(input);
    expect(out).not.toMatch(/\s…$/);
  });
});
