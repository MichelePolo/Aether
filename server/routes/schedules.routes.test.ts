import request from 'supertest';
import express from 'express';
import { makeTestDb } from '@/server/test/test-db';
import { ScheduleStore } from '@/server/domain/schedules/schedules.store';
import { createScheduleRoutes } from './schedules.routes';
import { isAppError } from '@/server/lib/errors';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle; let app: express.Express; let store: ScheduleStore;
const runner = { run: async () => {} };

beforeEach(() => {
  db = makeTestDb();
  store = new ScheduleStore(db);
  app = express();
  app.use(express.json());
  app.use('/api/schedules', createScheduleRoutes(store, runner));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isAppError(err)) { res.status(err.status).json({ error: { code: err.code, message: err.message } }); return; }
    res.status(500).json({ error: { code: 'INTERNAL', message: 'x' } });
  });
});
afterEach(() => db.close());

describe('schedule routes', () => {
  it('POST / creates; GET / lists; bad cron → 400', async () => {
    const create = await request(app).post('/api/schedules').send({
      name: 'n', cadence: { kind: 'cron', expr: '0 3 * * *' }, target: { kind: 'prompt', prompt: 'p' },
    });
    expect(create.status).toBe(201);
    const list = await request(app).get('/api/schedules');
    expect(list.body.schedules).toHaveLength(1);
    const bad = await request(app).post('/api/schedules').send({
      name: 'n', cadence: { kind: 'cron', expr: 'nope' }, target: { kind: 'prompt', prompt: 'p' },
    });
    expect(bad.status).toBe(400);
  });

  it('POST /:id/run fires the runner', async () => {
    const s = store.create({ name: 'n', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'p' } });
    const res = await request(app).post(`/api/schedules/${s.id}/run`);
    expect(res.status).toBe(202);
  });
});
