import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeTestDb } from '@/server/test/test-db';
import { HistoryStore } from '@/server/domain/history/history.store';
import { createSessionsRoutes } from './sessions.routes';
import type { DatabaseHandle } from '@/server/db/database';
import { isAppError } from '@/server/lib/errors';
import { createApp } from '@/server/app';

let db: DatabaseHandle;
let history: HistoryStore;
let app: express.Express;

beforeEach(() => {
  db = makeTestDb();
  history = new HistoryStore(db);
  app = express();
  // Match the production wiring: mount router BEFORE global json parser
  // so its inline 10 MB parser takes effect.
  app.use('/api/sessions', createSessionsRoutes(history));
  app.use(express.json({ limit: '1mb' }));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    // Express HTTP errors (e.g. 413 entity.too.large) carry a numeric `status`.
    if (typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
      const httpErr = err as { status: number; message?: string };
      res.status(httpErr.status).json({ error: { code: 'HTTP_ERROR', message: httpErr.message ?? 'HTTP error' } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'INTERNAL', message } });
  });
});

afterEach(() => db.close());

describe('GET /api/sessions/:id/export', () => {
  it('returns 200 + envelope + Content-Disposition for an existing session', async () => {
    const s = await history.createEmpty();
    await history.rename(s.id, 'demo');
    await history.append(s.id, {
      id: 'm1',
      role: 'user',
      text: 'hello',
      timestamp: 100,
    });

    const res = await request(app).get(`/api/sessions/${s.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(/attachment;\s*filename="aether-session-.+\.json"/);
    expect(res.body.app).toBe('aether');
    expect(res.body.version).toBe(1);
    expect(res.body.session.messages).toHaveLength(1);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/sessions/nope/export');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/sessions/import', () => {
  const valid = {
    app: 'aether',
    version: 1,
    exportedAt: 0,
    session: {
      title: 'imported',
      createdAt: 1,
      messages: [{ id: 'orig', role: 'user', text: 'hi', timestamp: 1 }],
    },
  };

  it('returns 201 + SessionMeta for a valid envelope', async () => {
    const res = await request(app).post('/api/sessions/import').send(valid);
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('imported');
    expect(typeof res.body.id).toBe('string');
    expect(res.body.id).not.toBe('orig');
    const list = await history.listSessions();
    expect(list.find((x) => x.id === res.body.id)).toBeDefined();
  });

  it('returns 400 for an invalid envelope', async () => {
    const res = await request(app)
      .post('/api/sessions/import')
      .send({ app: 'wrong', version: 1, exportedAt: 0, session: { title: 't', createdAt: 0, messages: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 413 when the payload exceeds 10 MB', async () => {
    const huge = {
      ...valid,
      session: {
        ...valid.session,
        messages: [
          {
            id: 'big',
            role: 'user',
            text: 'A'.repeat(11 * 1024 * 1024),
            timestamp: 0,
          },
        ],
      },
    };
    const res = await request(app)
      .post('/api/sessions/import')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(huge));
    expect(res.status).toBe(413);
  });
});

describe('createApp wiring', () => {
  it('GET /:id/export is reachable via createApp({ historyStore })', async () => {
    const wiredApp = createApp({ historyStore: history });
    const s = await history.createEmpty();
    await history.rename(s.id, 'wired');

    const res = await request(wiredApp).get(`/api/sessions/${s.id}/export`);
    expect(res.status).toBe(200);
    expect(res.body.app).toBe('aether');
  });

  it('POST /import is reachable via createApp({ historyStore })', async () => {
    const wiredApp = createApp({ historyStore: history });
    const valid = {
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: {
        title: 'wired-import',
        createdAt: 1,
        messages: [],
      },
    };

    const res = await request(wiredApp).post('/api/sessions/import').send(valid);
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('wired-import');
  });
});
