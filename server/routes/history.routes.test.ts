import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '@/server/app';
import { ContextStore } from '@/server/domain/context/context.store';
import { HistoryStore } from '@/server/domain/history/history.store';

let dir: string;
let contextStore: ContextStore;
let historyStore: HistoryStore;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-hist-routes-'));
  contextStore = new ContextStore(path.join(dir, 'context.json'));
  historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
  app = createApp({ contextStore, historyStore });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('/api/sessions/default', () => {
  it('GET returns empty messages on empty history', async () => {
    const res = await request(app).get('/api/sessions/default');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messages: [] });
  });

  it('GET returns stored messages', async () => {
    await historyStore.append({ id: 'a', role: 'user', text: 'hi', timestamp: 1 });
    await historyStore.append({ id: 'b', role: 'model', text: 'hello', timestamp: 2 });
    const res = await request(app).get('/api/sessions/default');
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0]).toMatchObject({ id: 'a', role: 'user' });
  });

  it('DELETE clears the session', async () => {
    await historyStore.append({ id: 'a', role: 'user', text: 'x', timestamp: 1 });
    const res = await request(app).delete('/api/sessions/default');
    expect(res.status).toBe(204);
    expect(await historyStore.read()).toEqual([]);
  });
});
