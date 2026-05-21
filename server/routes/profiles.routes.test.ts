import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '@/server/app';
import { ContextStore } from '@/server/domain/context/context.store';
import { HistoryStore } from '@/server/domain/history/history.store';
import { ProfilesStore } from '@/server/domain/profiles/profiles.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

const validContext = {
  systemInstruction: 'sys',
  skills: [],
  tools: [],
  mcpServers: [],
};

let db: DatabaseHandle;
let contextStore: ContextStore;
let historyStore: HistoryStore;
let profilesStore: ProfilesStore;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = makeTestDb();
  contextStore = new ContextStore(db);
  historyStore = new HistoryStore(db);
  profilesStore = new ProfilesStore(db);
  app = createApp({ contextStore, historyStore, profilesStore });
});

afterEach(() => {
  db.close();
});

describe('/api/profiles', () => {
  it('GET returns empty list initially', async () => {
    const res = await request(app).get('/api/profiles');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ profiles: [] });
  });

  it('POST creates a profile', async () => {
    const res = await request(app)
      .post('/api/profiles')
      .send({ name: 'Coding', context: validContext, thinkingEnabled: true });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/[0-9a-f-]{36}/);
    expect(res.body.name).toBe('Coding');
    expect(typeof res.body.createdAt).toBe('number');
  });

  it('POST rejects empty name (400)', async () => {
    const res = await request(app)
      .post('/api/profiles')
      .send({ name: '', context: validContext, thinkingEnabled: false });
    expect(res.status).toBe(400);
  });

  it('POST rejects missing context (400)', async () => {
    const res = await request(app)
      .post('/api/profiles')
      .send({ name: 'X', thinkingEnabled: false });
    expect(res.status).toBe(400);
  });

  it('GET /:id returns full ProfileRecord', async () => {
    const meta = await profilesStore.create({ name: 'A', context: validContext, thinkingEnabled: true });
    const res = await request(app).get(`/api/profiles/${meta.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'A', thinkingEnabled: true, context: validContext });
  });

  it('GET /:id returns 404 for unknown', async () => {
    const res = await request(app).get('/api/profiles/nope');
    expect(res.status).toBe(404);
  });

  it('PUT /:id full overwrite preserves createdAt', async () => {
    const meta = await profilesStore.create({ name: 'A', context: validContext, thinkingEnabled: false });
    const original = await profilesStore.read(meta.id);
    const res = await request(app)
      .put(`/api/profiles/${meta.id}`)
      .send({
        name: 'A',
        createdAt: 999, // attempt to rewrite history — should be ignored
        updatedAt: Date.now(),
        context: { ...validContext, systemInstruction: 'updated' },
        thinkingEnabled: true,
      });
    expect(res.status).toBe(200);
    const rec = await profilesStore.read(meta.id);
    expect(rec?.createdAt).toBe(original!.createdAt);
    expect(rec?.context.systemInstruction).toBe('updated');
    expect(rec?.thinkingEnabled).toBe(true);
  });

  it('PUT /:id returns 404 for unknown', async () => {
    const res = await request(app).put('/api/profiles/nope').send({
      name: 'X',
      createdAt: 1,
      updatedAt: 1,
      context: validContext,
      thinkingEnabled: false,
    });
    expect(res.status).toBe(404);
  });

  it('PUT /:id rejects invalid body (400)', async () => {
    const meta = await profilesStore.create({ name: 'A', context: validContext, thinkingEnabled: false });
    const res = await request(app).put(`/api/profiles/${meta.id}`).send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('PATCH /:id renames', async () => {
    const meta = await profilesStore.create({ name: 'A', context: validContext, thinkingEnabled: false });
    const res = await request(app).patch(`/api/profiles/${meta.id}`).send({ name: 'B' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('B');
  });

  it('PATCH /:id rejects empty name (400)', async () => {
    const meta = await profilesStore.create({ name: 'A', context: validContext, thinkingEnabled: false });
    const res = await request(app).patch(`/api/profiles/${meta.id}`).send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('PATCH /:id 404 for unknown', async () => {
    const res = await request(app).patch('/api/profiles/nope').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('DELETE /:id removes', async () => {
    const meta = await profilesStore.create({ name: 'A', context: validContext, thinkingEnabled: false });
    const res = await request(app).delete(`/api/profiles/${meta.id}`);
    expect(res.status).toBe(204);
    expect(await profilesStore.read(meta.id)).toBeNull();
  });

  it('DELETE /:id 404 for unknown', async () => {
    const res = await request(app).delete('/api/profiles/nope');
    expect(res.status).toBe(404);
  });

  it('POST /import creates a profile from loose body', async () => {
    const res = await request(app)
      .post('/api/profiles/import')
      .send({ name: 'Imported', context: validContext, thinkingEnabled: true });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Imported');
  });

  it('POST /import fills default name when absent', async () => {
    const res = await request(app)
      .post('/api/profiles/import')
      .send({ context: validContext });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Imported profile');
  });

  it('POST /import fills default thinkingEnabled=false when absent', async () => {
    const res = await request(app)
      .post('/api/profiles/import')
      .send({ context: validContext, name: 'X' });
    expect(res.status).toBe(201);
    const rec = await profilesStore.read(res.body.id);
    expect(rec?.thinkingEnabled).toBe(false);
  });

  it('POST /import suffixes collisions', async () => {
    await profilesStore.create({ name: 'Dup', context: validContext, thinkingEnabled: false });
    const res = await request(app)
      .post('/api/profiles/import')
      .send({ name: 'Dup', context: validContext });
    expect(res.body.name).toBe('Dup (1)');
  });

  it('POST /import rejects missing context (400)', async () => {
    const res = await request(app).post('/api/profiles/import').send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  it('POST /import ignores extra unknown fields (passthrough)', async () => {
    const res = await request(app)
      .post('/api/profiles/import')
      .send({ name: 'X', context: validContext, futureField: 'whatever' });
    expect(res.status).toBe(201);
  });

  it('returns 404 for profile endpoints when profilesStore dep missing', async () => {
    const appWithout = createApp({ contextStore, historyStore });
    const res = await request(appWithout).get('/api/profiles');
    expect(res.status).toBe(404);
  });
});
