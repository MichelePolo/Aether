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

describe('/api/sessions', () => {
  it('GET returns empty list initially', async () => {
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessions: [] });
  });

  it('POST creates an empty session', async () => {
    const res = await request(app).post('/api/sessions');
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/[0-9a-f-]{36}/);
    expect(res.body.title).toBe('');
    expect(typeof res.body.createdAt).toBe('number');
  });

  it('GET lists created sessions', async () => {
    const a = await historyStore.createEmpty();
    const b = await historyStore.createEmpty();
    const res = await request(app).get('/api/sessions');
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions.map((s: { id: string }) => s.id)).toEqual(
      expect.arrayContaining([a.id, b.id]),
    );
  });

  it('GET /:id returns messages of the session', async () => {
    const meta = await historyStore.createEmpty();
    await historyStore.append(meta.id, { id: 'a', role: 'user', text: 'hi', timestamp: 1 });
    const res = await request(app).get(`/api/sessions/${meta.id}`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toMatchObject({ id: 'a', role: 'user' });
  });

  it('GET /:id returns 404 for unknown session', async () => {
    const res = await request(app).get('/api/sessions/nope');
    expect(res.status).toBe(404);
  });

  it('PATCH /:id renames the session', async () => {
    const meta = await historyStore.createEmpty();
    const res = await request(app)
      .patch(`/api/sessions/${meta.id}`)
      .send({ title: 'My chat' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('My chat');
  });

  it('PATCH /:id rejects empty title', async () => {
    const meta = await historyStore.createEmpty();
    const res = await request(app)
      .patch(`/api/sessions/${meta.id}`)
      .send({ title: '' });
    expect(res.status).toBe(400);
  });

  it('PATCH /:id returns 404 for unknown session', async () => {
    const res = await request(app).patch('/api/sessions/nope').send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  it('DELETE /:id removes the session', async () => {
    const meta = await historyStore.createEmpty();
    const res = await request(app).delete(`/api/sessions/${meta.id}`);
    expect(res.status).toBe(204);
    expect(await historyStore.read(meta.id)).toBeNull();
  });

  it('DELETE /:id returns 404 for unknown session', async () => {
    const res = await request(app).delete('/api/sessions/nope');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/history/:id providerName (slice-8)', () => {
  it('accepts providerName and persists it', async () => {
    const meta = await historyStore.createEmpty();
    const res = await request(app)
      .patch(`/api/sessions/${meta.id}`)
      .send({ providerName: 'ollama:llama3' });
    expect(res.status).toBe(200);
    const record = await historyStore.readRecord(meta.id);
    expect(record?.providerName).toBe('ollama:llama3');
  });

  it('rejects empty body', async () => {
    const meta = await historyStore.createEmpty();
    const res = await request(app)
      .patch(`/api/sessions/${meta.id}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('accepts both fields at once', async () => {
    const meta = await historyStore.createEmpty();
    const res = await request(app)
      .patch(`/api/sessions/${meta.id}`)
      .send({ title: 'new-title', providerName: 'fake:default' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('new-title');
    const record = await historyStore.readRecord(meta.id);
    expect(record?.providerName).toBe('fake:default');
  });
});
