import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';
import { OpenAICompatEndpointStore } from './openai-endpoints.store';

let db: DatabaseHandle;
afterEach(() => db?.close());

describe('OpenAICompatEndpointStore', () => {
  it('creates an endpoint and lists it (no headers, no model)', () => {
    db = makeTestDb();
    const store = new OpenAICompatEndpointStore(db);
    const created = store.create({ label: 'vllm-plain', baseUrl: 'http://gpu.lan:8000/v1' });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.model).toBeNull();
    expect(created.headerKeys).toEqual([]);
    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe('vllm-plain');
  });

  it('create/list cifra gli header e li maschera in list()', () => {
    db = makeTestDb();
    const store = new OpenAICompatEndpointStore(db);
    const created = store.create({
      label: 'vllm',
      baseUrl: 'https://v/v1',
      model: 'qwen',
      headers: { Authorization: 'Bearer s3cret' },
    });
    const pub = store.list().find((e) => e.id === created.id)!;
    expect(pub.headerKeys).toEqual(['Authorization']); // solo chiavi, niente valore
    expect(JSON.stringify(pub)).not.toContain('s3cret'); // mai in chiaro
    const resolved = store.listResolved().find((e) => e.id === created.id)!;
    expect(resolved.headers.Authorization).toBe('Bearer s3cret'); // decifrato solo qui
  });

  it('listResolved() returns decrypted headers for internal use', () => {
    db = makeTestDb();
    const store = new OpenAICompatEndpointStore(db);
    const c = store.create({
      label: 'multi-header',
      baseUrl: 'https://x/v1',
      headers: { Authorization: 'Bearer tok', 'X-Custom': 'val' },
    });
    const resolved = store.listResolved().find((e) => e.id === c.id)!;
    expect(resolved.headers.Authorization).toBe('Bearer tok');
    expect(resolved.headers['X-Custom']).toBe('val');
  });

  it('stores model and returns it', () => {
    db = makeTestDb();
    const store = new OpenAICompatEndpointStore(db);
    const c = store.create({ label: 'with-model', baseUrl: 'https://x/v1', model: 'llama3' });
    expect(c.model).toBe('llama3');
    expect(store.get(c.id)!.model).toBe('llama3');
  });

  it('update() changes label/url/model and can clear headers', () => {
    db = makeTestDb();
    const store = new OpenAICompatEndpointStore(db);
    const c = store.create({
      label: 'a',
      baseUrl: 'http://a/v1',
      model: 'old',
      headers: { Authorization: 'Bearer x' },
    });
    const u = store.update(c.id, { label: 'b', baseUrl: 'http://b/v1', model: 'new', headers: {} });
    expect(u.label).toBe('b');
    expect(u.baseUrl).toBe('http://b/v1');
    expect(u.model).toBe('new');
    expect(u.headerKeys).toEqual([]);
    expect(store.listResolved().find((e) => e.id === c.id)!.headers).toEqual({});
  });

  it('update() leaves headers untouched when headers is undefined', () => {
    db = makeTestDb();
    const store = new OpenAICompatEndpointStore(db);
    const c = store.create({
      label: 'a',
      baseUrl: 'http://a/v1',
      headers: { Authorization: 'Bearer secret' },
    });
    store.update(c.id, { label: 'a2' });
    const resolved = store.listResolved().find((e) => e.id === c.id)!;
    expect(resolved.headers.Authorization).toBe('Bearer secret');
  });

  it('remove() deletes the endpoint', () => {
    db = makeTestDb();
    const store = new OpenAICompatEndpointStore(db);
    const c = store.create({ label: 'a', baseUrl: 'http://a/v1' });
    store.remove(c.id);
    expect(store.list()).toHaveLength(0);
  });

  it('throws on duplicate label (UNIQUE constraint)', () => {
    db = makeTestDb();
    const store = new OpenAICompatEndpointStore(db);
    store.create({ label: 'dup', baseUrl: 'http://a/v1' });
    expect(() => store.create({ label: 'dup', baseUrl: 'http://b/v1' })).toThrow();
  });
});
