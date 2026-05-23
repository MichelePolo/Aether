import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeTestDb } from '@/server/test/test-db';
import { HistoryStore } from '@/server/domain/history/history.store';
import { createAttachmentsRoutes } from './attachments.routes';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let history: HistoryStore;
let app: express.Express;

beforeEach(() => {
  db = makeTestDb();
  history = new HistoryStore(db);
  app = express();
  app.use('/api/attachments', createAttachmentsRoutes(history));
});

afterEach(() => db.close());

describe('GET /api/attachments/:id', () => {
  it('returns the BLOB with the right Content-Type for a stored attachment', async () => {
    const s = await history.createEmpty();
    await history.append(s.id, {
      id: 'u1', role: 'user', text: 'hi', timestamp: 1,
      attachments: [{ id: 'a1', mime: 'image/png', name: 'p.png', size: 4, contentBase64: Buffer.from('PNG!').toString('base64') }],
    });
    const res = await request(app).get('/api/attachments/a1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.body.toString('utf-8')).toBe('PNG!');
  });

  it('returns 404 for unknown attachment id', async () => {
    const res = await request(app).get('/api/attachments/missing');
    expect(res.status).toBe(404);
  });
});
