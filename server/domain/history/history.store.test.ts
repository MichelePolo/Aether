import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HistoryStore } from './history.store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let dir: string;
let store: HistoryStore;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-history-'));
  filePath = path.join(dir, 'sessions.json');
  store = new HistoryStore(filePath);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('HistoryStore', () => {
  it('listSessions returns [] on empty file', async () => {
    expect(await store.listSessions()).toEqual([]);
  });

  it('createEmpty produces a meta with UUID + 0 messages', async () => {
    const meta = await store.createEmpty();
    expect(meta.id).toMatch(UUID_RE);
    expect(meta.title).toBe('');
    expect(typeof meta.createdAt).toBe('number');
    expect(meta.updatedAt).toBe(meta.createdAt);
    const list = await store.listSessions();
    expect(list.map((s) => s.id)).toContain(meta.id);
  });

  it('read returns null for unknown session', async () => {
    expect(await store.read('nope')).toBeNull();
  });

  it('read returns the messages of a populated session', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, { id: 'a', role: 'user', text: 'hi', timestamp: 1 });
    const msgs = await store.read(meta.id);
    expect(msgs).toEqual([{ id: 'a', role: 'user', text: 'hi', timestamp: 1 }]);
  });

  it('append auto-titles when session is empty and message is user', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, { id: 'a', role: 'user', text: 'ciao mondo', timestamp: 1 });
    const list = await store.listSessions();
    const s = list.find((x) => x.id === meta.id)!;
    expect(s.title).toBe('ciao mondo');
  });

  it('append does NOT re-title after first message', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, { id: 'a', role: 'user', text: 'first', timestamp: 1 });
    await store.append(meta.id, { id: 'b', role: 'model', text: 'reply', timestamp: 2 });
    await store.append(meta.id, { id: 'c', role: 'user', text: 'second', timestamp: 3 });
    const list = await store.listSessions();
    expect(list.find((x) => x.id === meta.id)!.title).toBe('first');
  });

  it('append does NOT auto-title when first message is model role', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, { id: 'm', role: 'model', text: 'orphan', timestamp: 1 });
    const list = await store.listSessions();
    expect(list.find((x) => x.id === meta.id)!.title).toBe('');
  });

  it('append throws NotFoundError for unknown sessionId', async () => {
    await expect(
      store.append('nope', { id: 'a', role: 'user', text: 'hi', timestamp: 1 }),
    ).rejects.toThrow();
  });

  it('rename updates title; throws NotFound for missing id', async () => {
    const meta = await store.createEmpty();
    const updated = await store.rename(meta.id, 'My chat');
    expect(updated.title).toBe('My chat');
    await expect(store.rename('nope', 'x')).rejects.toThrow();
  });

  it('rename rejects empty title', async () => {
    const meta = await store.createEmpty();
    await expect(store.rename(meta.id, '')).rejects.toThrow();
    await expect(store.rename(meta.id, '   ')).rejects.toThrow();
  });

  it('rename rejects title over 200 chars', async () => {
    const meta = await store.createEmpty();
    await expect(store.rename(meta.id, 'a'.repeat(201))).rejects.toThrow();
  });

  it('delete removes the session; throws NotFound for missing id', async () => {
    const meta = await store.createEmpty();
    await store.delete(meta.id);
    expect(await store.read(meta.id)).toBeNull();
    await expect(store.delete(meta.id)).rejects.toThrow();
  });

  it('listSessions orders by updatedAt desc', async () => {
    const a = await store.createEmpty();
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.createEmpty();
    await new Promise((r) => setTimeout(r, 5));
    // touch a by appending message
    await store.append(a.id, { id: 'x', role: 'user', text: 'touch a', timestamp: Date.now() + 1000 });
    const list = await store.listSessions();
    expect(list[0].id).toBe(a.id);   // updated last
    expect(list[1].id).toBe(b.id);
  });

  it('migrate-on-load idempotently converts legacy default key', async () => {
    // Pre-populate disk with legacy V1 shape
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ default: [{ id: 'a', role: 'user', text: 'legacy', timestamp: 1 }] }),
    );
    const list = await store.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].id).toMatch(UUID_RE);
    expect(list[0].title).toBe('legacy');
    // Second call should still return the same session (idempotent)
    const list2 = await store.listSessions();
    expect(list2).toEqual(list);
  });

  it('persists across instances (file-backed)', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, { id: 'p', role: 'user', text: 'persist', timestamp: 1 });
    const store2 = new HistoryStore(filePath);
    const msgs = await store2.read(meta.id);
    expect(msgs).toEqual([{ id: 'p', role: 'user', text: 'persist', timestamp: 1 }]);
  });

  it('append+read preserves reasoningSteps', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, {
      id: 'u', role: 'user', text: 'hi', timestamp: 1,
    });
    await store.append(meta.id, {
      id: 'm',
      role: 'model',
      text: 'pong',
      timestamp: 2,
      model: 'fake-1',
      reasoningSteps: [
        { id: 's1', type: 'context_fetch', title: 't', content: 'c', timestamp: 1, durationMs: 5 },
        { id: 's2', type: 'dispatch', title: 't2', content: 'c2', timestamp: 2, tokens: 42, durationMs: 100 },
      ],
    });
    const msgs = await store.read(meta.id);
    const model = msgs!.find((m) => m.role === 'model')!;
    expect(model.reasoningSteps).toHaveLength(2);
    expect(model.reasoningSteps![0]).toMatchObject({ type: 'context_fetch', durationMs: 5 });
    expect(model.reasoningSteps![1]).toMatchObject({ type: 'dispatch', tokens: 42 });
  });
});
