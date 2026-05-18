import { describe, it, expect } from 'vitest';
import { migrateLegacyDefault } from './history.migrate';
import type { Message } from './history.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('migrateLegacyDefault', () => {
  it('returns same shape when no legacy default key present', () => {
    const file = {};
    expect(migrateLegacyDefault(file)).toEqual({});
  });

  it('preserves already-V2 sessions untouched', () => {
    const file = {
      'abc12345-abcd-abcd-abcd-abcdef123456': { title: 'kept', createdAt: 1, messages: [] },
    };
    const out = migrateLegacyDefault(file);
    expect(out).toEqual(file);
  });

  it('converts legacy default with messages to V2 record', () => {
    const userMsg: Message = { id: 'u1', role: 'user', text: 'first prompt here', timestamp: 100 };
    const modelMsg: Message = { id: 'm1', role: 'model', text: 'response', timestamp: 200 };
    const file = { default: [userMsg, modelMsg] };
    const out = migrateLegacyDefault(file);
    expect(Object.keys(out)).toHaveLength(1);
    const [id] = Object.keys(out);
    expect(id).toMatch(UUID_RE);
    expect(out[id].title).toBe('first prompt here');
    expect(out[id].createdAt).toBe(100);
    expect(out[id].messages).toEqual([userMsg, modelMsg]);
  });

  it('converts empty legacy default to placeholder session', () => {
    const file = { default: [] as Message[] };
    const out = migrateLegacyDefault(file);
    expect(Object.keys(out)).toHaveLength(1);
    const [id] = Object.keys(out);
    expect(id).toMatch(UUID_RE);
    expect(out[id].title).toBe('Sessione importata');
    expect(typeof out[id].createdAt).toBe('number');
    expect(out[id].messages).toEqual([]);
  });

  it('uses model-only first message to fall back to placeholder title', () => {
    const modelMsg: Message = { id: 'm1', role: 'model', text: 'orphan', timestamp: 1 };
    const file = { default: [modelMsg] };
    const out = migrateLegacyDefault(file);
    const [id] = Object.keys(out);
    expect(out[id].title).toBe('Sessione importata');
  });

  it('is idempotent: re-running on migrated output yields same result (modulo ID stability)', () => {
    const file = { default: [{ id: 'u1', role: 'user' as const, text: 'a', timestamp: 1 }] };
    const first = migrateLegacyDefault(file);
    const second = migrateLegacyDefault(first);
    expect(second).toEqual(first);
  });

  it('re-keys SessionRecord-shaped default to a UUID', () => {
    const file = {
      default: { title: 'manual', createdAt: 100, messages: [] },
    };
    const out = migrateLegacyDefault(file);
    expect(Object.keys(out)).toHaveLength(1);
    const [id] = Object.keys(out);
    expect(id).toMatch(UUID_RE);
    expect(out[id]).toEqual({ title: 'manual', createdAt: 100, messages: [] });
    expect(out.default).toBeUndefined();
  });

  it('preserves other V2 keys when migrating default', () => {
    const file = {
      'xyz12345-abcd-abcd-abcd-abcdef123456': { title: 'kept', createdAt: 1, messages: [] },
      default: [{ id: 'u1', role: 'user' as const, text: 'a', timestamp: 1 }],
    };
    const out = migrateLegacyDefault(file);
    expect(Object.keys(out)).toHaveLength(2);
    expect(out['xyz12345-abcd-abcd-abcd-abcdef123456']).toEqual({
      title: 'kept', createdAt: 1, messages: [],
    });
    expect(out.default).toBeUndefined();
  });
});
