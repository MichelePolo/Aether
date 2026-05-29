import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '@/server/app';
import { SwarmStore } from '@/server/domain/swarms/swarm.store';
import { SwarmApprovalRegistry } from '@/server/domain/swarms/swarm.approval';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let approvals: SwarmApprovalRegistry;

function makeApp() {
  const swarmStore = new SwarmStore(db);
  approvals = new SwarmApprovalRegistry();
  const swarmOrchestratorDeps = {
    store: swarmStore,
    subAgentsStore: { list: async () => [] },
    dispatcher: { handle: async () => {} },
    createSession: async () => 'sess-1',
    approvals,
  };
  return createApp({ swarmStore, swarmApprovals: approvals, swarmOrchestratorDeps } as any);
}

describe('swarms routes', () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    db = makeTestDb();
    app = makeApp();
  });
  afterEach(() => db.close());

  it('CRUD: create, list, get, update, delete', async () => {
    const created = await request(app)
      .post('/api/swarms')
      .send({ name: 'build', steps: [{ subAgentName: 'architect', promptTemplate: '', pauseAfter: false }] });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const list = await request(app).get('/api/swarms');
    expect(list.body.swarms).toHaveLength(1);

    const got = await request(app).get(`/api/swarms/${id}`);
    expect(got.body.name).toBe('build');
    expect(got.body.steps).toHaveLength(1);

    const upd = await request(app).put(`/api/swarms/${id}`).send({ name: 'build2' });
    expect(upd.body.name).toBe('build2');

    const del = await request(app).delete(`/api/swarms/${id}`);
    expect(del.status).toBe(204);
  });

  it('rejects an invalid create payload', async () => {
    const res = await request(app).post('/api/swarms').send({ steps: [] });
    expect(res.status).toBe(400);
  });

  it('404 for unknown swarm', async () => {
    const res = await request(app).get('/api/swarms/nope');
    expect(res.status).toBe(404);
  });

  it('decision endpoint resolves a pending approval', async () => {
    const p = approvals.awaitDecision('x', 1000);
    const res = await request(app).post('/api/swarms/decision').send({ approvalId: 'x', action: 'approve' });
    expect(res.status).toBe(200);
    expect(await p).toBe('approve');
  });
});
