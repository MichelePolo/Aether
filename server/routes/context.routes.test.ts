import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '@/server/app';
import { ContextStore } from '@/server/domain/context/context.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: ContextStore;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = makeTestDb();
  store = new ContextStore(db);
  app = createApp({ contextStore: store });
});

afterEach(() => {
  db.close();
});

describe('/api/context routes', () => {
  it('GET /api/context returns default context', async () => {
    const res = await request(app).get('/api/context');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ skills: [], tools: [], mcpServers: [] });
    expect(typeof res.body.systemInstruction).toBe('string');
  });

  it('PATCH /api/context updates partially', async () => {
    const res = await request(app)
      .patch('/api/context')
      .send({ systemInstruction: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.systemInstruction).toBe('Updated');
  });

  it('PATCH /api/context rejects unknown field', async () => {
    const res = await request(app)
      .patch('/api/context')
      .send({ unknownField: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PUT /api/context overwrites with valid payload', async () => {
    const next = {
      systemInstruction: 'New',
      skills: ['a'],
      tools: [],
      mcpServers: [],
    };
    const res = await request(app).put('/api/context').send(next);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(next);
  });

  it('PUT /api/context rejects invalid payload', async () => {
    const res = await request(app)
      .put('/api/context')
      .send({ systemInstruction: 1 });
    expect(res.status).toBe(400);
  });

  it('POST /api/context/skills adds a skill', async () => {
    const res = await request(app).post('/api/context/skills').send({ name: 'NewSkill' });
    expect(res.status).toBe(201);
    const ctx = await store.read();
    expect(ctx.skills).toContain('NewSkill');
  });

  it('POST /api/context/skills rejects empty name', async () => {
    const res = await request(app).post('/api/context/skills').send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/context/skills/:index updates a skill', async () => {
    await store.addSkill('First');
    const res = await request(app)
      .patch('/api/context/skills/0')
      .send({ value: 'Updated' });
    expect(res.status).toBe(200);
    expect((await store.read()).skills[0]).toBe('Updated');
  });

  it('PATCH /api/context/skills/:index returns 404 for missing index', async () => {
    const res = await request(app)
      .patch('/api/context/skills/99')
      .send({ value: 'x' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/context/skills/:index removes a skill', async () => {
    await store.addSkill('Bye');
    const res = await request(app).delete('/api/context/skills/0');
    expect(res.status).toBe(204);
    expect((await store.read()).skills).toHaveLength(0);
  });

  it('POST /api/context/tools creates a tool with id', async () => {
    const res = await request(app)
      .post('/api/context/tools')
      .send({ name: 'X', version: '1.0', status: 'online' });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/.+/);
    expect(res.body.name).toBe('X');
  });

  it('POST /api/context/tools rejects invalid status', async () => {
    const res = await request(app)
      .post('/api/context/tools')
      .send({ name: 'X', version: '1.0', status: 'broken' });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/context/tools/:id updates a tool', async () => {
    const tool = await store.addTool({ name: 'X', version: '1.0', status: 'online' });
    const res = await request(app)
      .patch(`/api/context/tools/${tool.id}`)
      .send({ version: '2.0' });
    expect(res.status).toBe(200);
    expect((await store.read()).tools[0].version).toBe('2.0');
  });

  it('DELETE /api/context/tools/:id 404 on missing', async () => {
    const res = await request(app).delete('/api/context/tools/missing');
    expect(res.status).toBe(404);
  });

  it('POST /api/context/mcp-servers creates with id', async () => {
    const res = await request(app)
      .post('/api/context/mcp-servers')
      .send({ name: 'mock', url: 'http://x', status: 'connecting' });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/.+/);
  });

  it('DELETE /api/context/mcp-servers/:id removes', async () => {
    const srv = await store.addMcpServer({ name: 'mock', url: 'http://x', status: 'online' });
    const res = await request(app).delete(`/api/context/mcp-servers/${srv.id}`);
    expect(res.status).toBe(204);
    expect((await store.read()).mcpServers).toHaveLength(0);
  });
});
