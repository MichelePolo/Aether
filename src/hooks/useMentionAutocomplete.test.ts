import { describe, it, expect } from 'vitest';
import { computeMentionState } from './useMentionAutocomplete';

describe('computeMentionState', () => {
  it('closed when no @', () => {
    const s = computeMentionState('hello', 5);
    expect(s.open).toBe(false);
  });

  it('open at @ alone, caret right after', () => {
    const s = computeMentionState('@', 1);
    expect(s).toEqual({ open: true, query: '', replaceRange: [0, 1] });
  });

  it('open after @des', () => {
    const s = computeMentionState('@des', 4);
    expect(s).toEqual({ open: true, query: 'des', replaceRange: [0, 4] });
  });

  it('open after whitespace-anchored @des', () => {
    const s = computeMentionState('hello @des', 10);
    expect(s).toEqual({ open: true, query: 'des', replaceRange: [6, 10] });
  });

  it('closed when @ follows non-whitespace (e.g. email)', () => {
    const s = computeMentionState('mail @user@domain', 17);
    expect(s.open).toBe(false);
  });

  it('closed when there is a space after the name', () => {
    const s = computeMentionState('@designer ', 10);
    expect(s.open).toBe(false);
  });

  it('uses the caret position to slice query', () => {
    const s = computeMentionState('@designer', 4);
    expect(s).toEqual({ open: true, query: 'des', replaceRange: [0, 4] });
  });

  it('closed when there is no @ before the caret', () => {
    const s = computeMentionState('designer', 4);
    expect(s.open).toBe(false);
  });
});
