import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeTestDb } from '@/server/test/test-db';
import { HistoryStore } from '@/server/domain/history/history.store';
import { SearchService } from '@/server/domain/search/search.service';
import { createSearchRoutes } from './search.routes';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let history: HistoryStore;
let app: express.Express;

beforeEach(() => {
  db = makeTestDb();
  history = new HistoryStore(db);
  const svc = new SearchService(db);
  app = express();
  app.use(express.json());
  app.use('/api/search', createSearchRoutes(svc));
});

afterEach(() => {
  db.close();
});

describe('GET /api/search', () => {
  it('returns grouped hits for a matching query', async () => {
    const s = await history.createEmpty();
    await history.rename(s.id, 'My Session');
    await history.append(s.id, {
      id: 'm1',
      role: 'user',
      text: 'discussing hyperloop transit',
      timestamp: Date.now(),
    });

    const res = await request(app).get('/api/search').query({ q: 'hyperloop' });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].sessionId).toBe(s.id);
    expect(res.body.results[0].hits[0].snippet).toContain('«M»');
  });

  it('returns 400 with MISSING_QUERY when q is absent', async () => {
    const res = await request(app).get('/api/search');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_QUERY');
  });

  it('returns 200 with empty results when q is whitespace-only', async () => {
    const res = await request(app).get('/api/search').query({ q: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('respects the limit query param', async () => {
    const s = await history.createEmpty();
    for (let i = 0; i < 5; i++) {
      await history.append(s.id, {
        id: `m${i}`,
        role: 'user',
        text: `searchterm number ${i}`,
        timestamp: Date.now(),
      });
    }
    const res = await request(app)
      .get('/api/search')
      .query({ q: 'searchterm', limit: '2' });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].hits).toHaveLength(2);
  });
});
