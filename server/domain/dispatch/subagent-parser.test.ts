import { describe, it, expect } from 'vitest';
import { parseLeadingMention } from './subagent-parser';

const KNOWN = new Set(['designer', 'coder', 'a_b-c']);

describe('parseLeadingMention', () => {
  it('matches leading @name with whitespace', () => {
    expect(parseLeadingMention('@designer hello', KNOWN)).toEqual({
      name: 'designer',
      stripped: 'hello',
    });
  });

  it('matches when message is just @name', () => {
    expect(parseLeadingMention('@designer', KNOWN)).toEqual({
      name: 'designer',
      stripped: '',
    });
  });

  it('returns null name when there is no leading @', () => {
    expect(parseLeadingMention('hello @designer', KNOWN)).toEqual({
      name: null,
      stripped: 'hello @designer',
    });
  });

  it('returns null name for unknown name (preserves original)', () => {
    expect(parseLeadingMention('@unknown hello', KNOWN)).toEqual({
      name: null,
      stripped: '@unknown hello',
    });
  });

  it('accepts underscore + dash names', () => {
    expect(parseLeadingMention('@a_b-c make it', KNOWN)).toEqual({
      name: 'a_b-c',
      stripped: 'make it',
    });
  });

  it('rejects name starting with digit', () => {
    expect(parseLeadingMention('@1designer hello', new Set(['1designer']))).toEqual({
      name: null,
      stripped: '@1designer hello',
    });
  });

  it('rejects @ followed by non-letter', () => {
    expect(parseLeadingMention('@-foo bar', new Set())).toEqual({
      name: null,
      stripped: '@-foo bar',
    });
  });

  it('returns empty stripped for empty message', () => {
    expect(parseLeadingMention('', KNOWN)).toEqual({ name: null, stripped: '' });
  });

  it('consumes multiple spaces after name', () => {
    expect(parseLeadingMention('@designer   hello', KNOWN)).toEqual({
      name: 'designer',
      stripped: 'hello',
    });
  });
});
