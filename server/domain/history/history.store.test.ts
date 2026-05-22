import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HistoryStore } from './history.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';
import type { Message } from './history.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let db: DatabaseHandle;
let store: HistoryStore;

beforeEach(() => {
  db = makeTestDb();
  store = new HistoryStore(db);
});

afterEach(() => {
  db.close();
});

describe('HistoryStore', () => {
  it('listSessions returns [] on a fresh DB', async () => {
    expect(await store.listSessions()).toEqual([]);
  });

  it('createEmpty produces a meta with UUID + matching createdAt/updatedAt', async () => {
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

  it('append() infers title from the first user message (long text)', async () => {
    const s = await store.createEmpty();
    const msg: Message = { id: 'm1', role: 'user', text: 'Hello world this is the prompt', timestamp: Date.now() };
    await store.append(s.id, msg);
    const list = await store.listSessions();
    expect(list[0].title).toBeTruthy();
    expect(list[0].title).toContain('Hello');
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

  it('append() preserves an explicitly-set title', async () => {
    const s = await store.createEmpty();
    await store.rename(s.id, 'My session');
    await store.append(s.id, { id: 'm1', role: 'user', text: 'q', timestamp: Date.now() });
    const list = await store.listSessions();
    expect(list[0].title).toBe('My session');
  });

  it('append throws NotFoundError for unknown sessionId', async () => {
    await expect(
      store.append('nope', { id: 'a', role: 'user', text: 'hi', timestamp: 1 }),
    ).rejects.toThrow();
  });

  it('append() updates updatedAt to the message timestamp', async () => {
    const s = await store.createEmpty();
    const later = s.createdAt + 5000;
    await store.append(s.id, { id: 'm1', role: 'user', text: 'q', timestamp: later });
    const list = await store.listSessions();
    expect(list[0].updatedAt).toBe(later);
  });

  it('append() round-trips reasoningSteps + tool_call traces', async () => {
    const s = await store.createEmpty();
    const msg: Message = {
      id: 'm1',
      role: 'model',
      text: 'reply',
      timestamp: Date.now(),
      reasoningSteps: [
        {
          id: 'r1',
          type: 'context_fetch',
          title: 'context',
          content: 'loaded',
          tokens: 100,
          durationMs: 12,
          timestamp: Date.now(),
        },
        {
          id: 'r2',
          type: 'tool_call',
          title: 'Tool: mock.echo',
          content: 'used mock.echo',
          durationMs: 5,
          timestamp: Date.now(),
          toolCall: {
            id: 'TC1',
            qualifiedName: 'mock.echo',
            args: { message: 'hi' },
            result: { message: 'hi' },
            durationMs: 5,
            progressNote: '1/1',
          },
        },
      ],
    };
    await store.append(s.id, msg);
    const messages = await store.read(s.id);
    expect(messages).toHaveLength(1);
    const m = messages![0];
    expect(m.reasoningSteps).toHaveLength(2);
    expect(m.reasoningSteps![0].tokens).toBe(100);
    expect(m.reasoningSteps![1].toolCall).toEqual({
      id: 'TC1',
      qualifiedName: 'mock.echo',
      args: { message: 'hi' },
      result: { message: 'hi' },
      durationMs: 5,
      progressNote: '1/1',
    });
  });

  it('append+read preserves multiple reasoningSteps (no tool calls)', async () => {
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

  it('append() round-trips optional Message fields (model, interrupted, error, retryable)', async () => {
    const s = await store.createEmpty();
    await store.append(s.id, {
      id: 'm1',
      role: 'model',
      text: '',
      timestamp: Date.now(),
      model: 'gpt-5',
      interrupted: true,
      error: 'boom',
      retryable: false,
    });
    const messages = await store.read(s.id);
    expect(messages![0]).toMatchObject({
      model: 'gpt-5',
      interrupted: true,
      error: 'boom',
      retryable: false,
    });
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

  it('delete() cascades to messages, reasoning_steps, tool_call_traces', async () => {
    const s = await store.createEmpty();
    await store.append(s.id, {
      id: 'm1',
      role: 'user',
      text: 'q',
      timestamp: Date.now(),
      reasoningSteps: [{
        id: 'r1',
        type: 'tool_call',
        title: 'T',
        content: '',
        durationMs: 1,
        timestamp: Date.now(),
        toolCall: { id: 'TC1', qualifiedName: 'a.b', args: {}, durationMs: 1 },
      }],
    });
    await store.delete(s.id);
    expect((db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM reasoning_steps').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tool_call_traces').get() as { n: number }).n).toBe(0);
  });

  it('readRecord() returns the full record including messages', async () => {
    const s = await store.createEmpty({ providerName: 'fake:default' });
    await store.append(s.id, { id: 'm1', role: 'user', text: 'q', timestamp: Date.now() });
    const rec = await store.readRecord(s.id);
    expect(rec).not.toBeNull();
    expect(rec!.providerName).toBe('fake:default');
    expect(rec!.messages).toHaveLength(1);
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

  it('append() populates messages_fts with the same fields', async () => {
    const s = await store.createEmpty();
    await store.append(s.id, {
      id: 'm-fts-1',
      role: 'user',
      text: 'searchable hello world',
      timestamp: Date.now(),
    });
    const row = db
      .prepare('SELECT message_id, session_id, role, content FROM messages_fts WHERE message_id = ?')
      .get('m-fts-1') as { message_id: string; session_id: string; role: string; content: string };
    expect(row).toEqual({
      message_id: 'm-fts-1',
      session_id: s.id,
      role: 'user',
      content: 'searchable hello world',
    });
  });

  it('delete(sessionId) cascades to messages_fts rows', async () => {
    const s = await store.createEmpty();
    await store.append(s.id, { id: 'mf1', role: 'user', text: 'a', timestamp: Date.now() });
    await store.append(s.id, { id: 'mf2', role: 'model', text: 'b', timestamp: Date.now() });
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM messages_fts WHERE session_id = ?').get(s.id) as { n: number }).n,
    ).toBe(2);
    await store.delete(s.id);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM messages_fts WHERE session_id = ?').get(s.id) as { n: number }).n,
    ).toBe(0);
  });
});

describe('providerName persistence (slice-8)', () => {
  it('createEmpty accepts an optional providerName and persists it', async () => {
    const meta = await store.createEmpty({ providerName: 'ollama:llama3' });
    const rec = await store.readRecord(meta.id);
    expect(rec?.providerName).toBe('ollama:llama3');
  });

  it('createEmpty without providerName leaves the field undefined', async () => {
    const meta = await store.createEmpty();
    const rec = await store.readRecord(meta.id);
    expect(rec?.providerName).toBeUndefined();
  });

  it('setProviderName updates an existing session', async () => {
    const meta = await store.createEmpty();
    await store.setProviderName(meta.id, 'gemini:gemini-2.0-flash-exp');
    const rec = await store.readRecord(meta.id);
    expect(rec?.providerName).toBe('gemini:gemini-2.0-flash-exp');
  });

  it('setProviderName on unknown id throws NotFoundError', async () => {
    await expect(store.setProviderName('bogus', 'fake:default')).rejects.toThrow();
  });
});

import { EXPORT_VERSION } from './history.export';

describe('HistoryStore.exportSession', () => {
  it('returns null for unknown id', async () => {
    const env = await store.exportSession('does-not-exist');
    expect(env).toBeNull();
  });

  it('returns a versioned envelope for a seeded session', async () => {
    const s = await store.createEmpty({ providerName: 'fake:default' });
    await store.append(s.id, { id: 'm1', role: 'user', text: 'hello', timestamp: 100 });

    const env = await store.exportSession(s.id);
    expect(env).not.toBeNull();
    expect(env!.app).toBe('aether');
    expect(env!.version).toBe(EXPORT_VERSION);
    expect(env!.session.title).toBe('hello'); // auto-titled from first user msg
    expect(env!.session.providerName).toBe('fake:default');
    expect(env!.session.messages).toHaveLength(1);
    expect(env!.session.messages[0].id).toBe('m1');
  });
});

describe('HistoryStore.importSession', () => {
  it('creates a new session with a fresh id', async () => {
    const meta = await store.importSession({
      app: 'aether', version: 1, exportedAt: 0,
      session: { title: 'imported', createdAt: 1, messages: [{ id: 'orig-1', role: 'user', text: 'hello', timestamp: 1 }] },
    });
    expect(meta.id).not.toBe('orig-1');
    expect(meta.title).toBe('imported');
    const list = await store.listSessions();
    expect(list.find((x) => x.id === meta.id)).toBeDefined();
  });

  it('regenerates message and reasoning ids', async () => {
    const meta = await store.importSession({
      app: 'aether', version: 1, exportedAt: 0,
      session: { title: 't', createdAt: 1, messages: [{
        id: 'orig-msg', role: 'model', text: 'answer', timestamp: 1,
        reasoningSteps: [{ id: 'orig-step', type: 'thought', title: 'thinking', content: 'x', timestamp: 1 }],
      }] },
    });
    const msgs = await store.read(meta.id);
    expect(msgs).not.toBeNull();
    expect(msgs![0].id).not.toBe('orig-msg');
    expect(msgs![0].reasoningSteps![0].id).not.toBe('orig-step');
  });

  it('sets all timestamps to a single Date.now() captured at import', async () => {
    const NOW = 9_999_000;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const meta = await store.importSession({
        app: 'aether', version: 1, exportedAt: 0,
        session: { title: 't', createdAt: 1, messages: [
          { id: 'a', role: 'user', text: 'one', timestamp: 100 },
          { id: 'b', role: 'model', text: 'two', timestamp: 200 },
        ] },
      });
      expect(meta.createdAt).toBe(NOW);
      expect(meta.updatedAt).toBe(NOW);
      const msgs = await store.read(meta.id);
      for (const m of msgs!) expect(m.timestamp).toBe(NOW);
    } finally {
      vi.useRealTimers();
    }
  });

  it('populates messages_fts so imported messages are searchable', async () => {
    const meta = await store.importSession({
      app: 'aether', version: 1, exportedAt: 0,
      session: { title: 't', createdAt: 1, messages: [{ id: 'a', role: 'user', text: 'banana custard', timestamp: 1 }] },
    });
    const row = db.prepare('SELECT count(*) as n FROM messages_fts WHERE session_id = ?').get(meta.id) as { n: number };
    expect(row.n).toBe(1);
  });

  it('preserves message order via position', async () => {
    const meta = await store.importSession({
      app: 'aether', version: 1, exportedAt: 0,
      session: { title: 't', createdAt: 1, messages: [
        { id: 'a', role: 'user', text: 'first', timestamp: 1 },
        { id: 'b', role: 'model', text: 'second', timestamp: 2 },
        { id: 'c', role: 'user', text: 'third', timestamp: 3 },
      ] },
    });
    const msgs = await store.read(meta.id);
    expect(msgs!.map((m) => m.text)).toEqual(['first', 'second', 'third']);
  });

  it('preserves providerName when present', async () => {
    const meta = await store.importSession({
      app: 'aether', version: 1, exportedAt: 0,
      session: { title: 't', createdAt: 1, providerName: 'fake:default', messages: [] },
    });
    expect(meta.providerName).toBe('fake:default');
  });
});
