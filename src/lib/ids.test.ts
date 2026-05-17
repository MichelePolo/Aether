import { describe, it, expect } from 'vitest';
import { newId } from './ids';

describe('newId', () => {
  it('returns a non-empty string', () => {
    expect(newId()).toMatch(/.+/);
  });

  it('returns unique values across rapid calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newId());
    expect(ids.size).toBe(1000);
  });

  it('returns a UUID-shaped string by default', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('accepts a prefix', () => {
    const id = newId('msg');
    expect(id).toMatch(/^msg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
