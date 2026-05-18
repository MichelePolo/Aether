import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HistoryStore, DEFAULT_SESSION_ID } from './history.store';

let dir: string;
let store: HistoryStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-history-'));
  store = new HistoryStore(path.join(dir, 'sessions.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('HistoryStore', () => {
  it('DEFAULT_SESSION_ID is "default"', () => {
    expect(DEFAULT_SESSION_ID).toBe('default');
  });

  it('read() returns empty array on empty file', async () => {
    expect(await store.read()).toEqual([]);
  });

  it('append() adds message and read() returns it', async () => {
    await store.append({ id: 'a', role: 'user', text: 'hi', timestamp: 1 });
    expect(await store.read()).toEqual([
      { id: 'a', role: 'user', text: 'hi', timestamp: 1 },
    ]);
  });

  it('append() preserves order', async () => {
    await store.append({ id: '1', role: 'user', text: 'a', timestamp: 1 });
    await store.append({ id: '2', role: 'model', text: 'b', timestamp: 2 });
    await store.append({ id: '3', role: 'user', text: 'c', timestamp: 3 });
    const msgs = await store.read();
    expect(msgs.map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('reset() clears the session', async () => {
    await store.append({ id: 'x', role: 'user', text: 't', timestamp: 1 });
    await store.reset();
    expect(await store.read()).toEqual([]);
  });

  it('persists across instances (file-backed)', async () => {
    await store.append({ id: 'p', role: 'user', text: 'persist', timestamp: 1 });
    const store2 = new HistoryStore(path.join(dir, 'sessions.json'));
    expect(await store2.read()).toEqual([
      { id: 'p', role: 'user', text: 'persist', timestamp: 1 },
    ]);
  });

  it('append accepts optional fields on model messages', async () => {
    await store.append({
      id: 'm',
      role: 'model',
      text: 'done',
      timestamp: 1,
      model: 'gemini-test',
      interrupted: false,
    });
    const msgs = await store.read();
    expect(msgs[0]).toMatchObject({ model: 'gemini-test', interrupted: false });
  });
});
