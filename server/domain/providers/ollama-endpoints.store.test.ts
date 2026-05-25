import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';
import { OllamaEndpointStore } from './ollama-endpoints.store';

let db: DatabaseHandle;
afterEach(() => db?.close());

describe('OllamaEndpointStore', () => {
  it('creates an endpoint and lists it (no token)', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const created = store.create({ label: 'lab', baseUrl: 'http://gpu.lan:11434' });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.hasToken).toBe(false);
    expect(created.tokenMasked).toBeNull();
    expect(created.fixed).toBe(false);
    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe('lab');
  });

  it('encrypts a token and exposes only a masked form via list()', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const created = store.create({ label: 'secure', baseUrl: 'https://ollama.example', token: 'tok-abcdef123456' });
    expect(created.hasToken).toBe(true);
    expect(created.tokenMasked).toBe('tok…3456');
    expect(created.tokenMasked).not.toContain('abcdef');
  });

  it('listResolved() returns the decrypted token for internal use', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const c = store.create({ label: 'secure', baseUrl: 'https://x', token: 'tok-abcdef123456' });
    const resolved = store.listResolved().find((e) => e.id === c.id)!;
    expect(resolved.token).toBe('tok-abcdef123456');
  });

  it('update() changes label/url and can clear the token with null', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const c = store.create({ label: 'a', baseUrl: 'http://a', token: 'tok-12345678' });
    const u = store.update(c.id, { label: 'b', baseUrl: 'http://b', token: null });
    expect(u.label).toBe('b');
    expect(u.baseUrl).toBe('http://b');
    expect(u.hasToken).toBe(false);
  });

  it('update() leaves the token untouched when token is undefined', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const c = store.create({ label: 'a', baseUrl: 'http://a', token: 'tok-12345678' });
    store.update(c.id, { label: 'a2' });
    expect(store.listResolved().find((e) => e.id === c.id)!.token).toBe('tok-12345678');
  });

  it('remove() deletes the endpoint', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const c = store.create({ label: 'a', baseUrl: 'http://a' });
    store.remove(c.id);
    expect(store.list()).toHaveLength(0);
  });

  it('throws on duplicate label (UNIQUE constraint)', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    store.create({ label: 'dup', baseUrl: 'http://a' });
    expect(() => store.create({ label: 'dup', baseUrl: 'http://b' })).toThrow();
  });

  it('returns hasToken=false when the stored auth tag is corrupted', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const c = store.create({ label: 'corrupt', baseUrl: 'http://a', token: 'tok-abcdef123456' });
    db.prepare(
      `UPDATE ollama_endpoints SET token_auth_tag = X'deadbeefdeadbeefdeadbeef' WHERE id = ?`,
    ).run(c.id);
    const rec = store.get(c.id)!;
    expect(rec.hasToken).toBe(false);
    expect(rec.tokenMasked).toBeNull();
  });
});
