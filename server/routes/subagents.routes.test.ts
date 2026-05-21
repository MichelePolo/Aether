import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '@/server/app';
import { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;

function makeApp() {
  const subAgentsStore = new SubAgentsStore(db);
  return createApp({ subAgentsStore });
}

describe('subagents routes', () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    db = makeTestDb();
    app = makeApp();
  });

  afterEach(() => {
    db.close();
  });

  it('GET /api/subagents returns empty list initially', async () => {
    const res = await request(app).get('/api/subagents');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subAgents: [] });
  });

  it('POST creates with default fields', async () => {
    const res = await request(app)
      .post('/api/subagents')
      .send({ name: 'designer' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('designer');
    expect(res.body.id).toBeTruthy();
  });

  it('POST with colliding name returns suffixed name', async () => {
    await request(app).post('/api/subagents').send({ name: 'designer' });
    const second = await request(app).post('/api/subagents').send({ name: 'designer' });
    expect(second.status).toBe(201);
    expect(second.body.name).toBe('designer (2)');
  });

  it('GET /:id returns full record', async () => {
    const created = await request(app)
      .post('/api/subagents')
      .send({ name: 'designer', systemInstruction: 'You design.' });
    const res = await request(app).get(`/api/subagents/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('designer');
    expect(res.body.systemInstruction).toBe('You design.');
  });

  it('GET /:id 404 on unknown id', async () => {
    const res = await request(app).get('/api/subagents/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('PUT updates fields', async () => {
    const created = await request(app)
      .post('/api/subagents')
      .send({ name: 'designer' });
    const res = await request(app)
      .put(`/api/subagents/${created.body.id}`)
      .send({ name: 'designer', systemInstruction: 'New.', skills: ['a'], tools: [] });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('designer');
  });

  it('PUT 400 on invalid body', async () => {
    const created = await request(app).post('/api/subagents').send({ name: 'designer' });
    const res = await request(app)
      .put(`/api/subagents/${created.body.id}`)
      .send({ name: '1invalid' });
    expect(res.status).toBe(400);
  });

  it('DELETE then GET 404', async () => {
    const created = await request(app).post('/api/subagents').send({ name: 'd' });
    const del = await request(app).delete(`/api/subagents/${created.body.id}`);
    expect(del.status).toBe(204);
    const get = await request(app).get(`/api/subagents/${created.body.id}`);
    expect(get.status).toBe(404);
  });

  it('POST 400 on invalid slug', async () => {
    const res = await request(app).post('/api/subagents').send({ name: '1designer' });
    expect(res.status).toBe(400);
  });
});
