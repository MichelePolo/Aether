import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import { AppError } from './lib/errors';

describe('createApp', () => {
  it('returns an express app without starting it', () => {
    const app = createApp({});
    expect(typeof app.listen).toBe('function');
  });

  it('exposes GET /api/health returning 200 ok', async () => {
    const app = createApp({});
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 404 for unknown routes', async () => {
    const app = createApp({});
    const res = await request(app).get('/api/__nope__');
    expect(res.status).toBe(404);
  });

  it('returns JSON error for handler-thrown AppError', async () => {
    // Express richiede che l'error middleware sia DOPO le route — usiamo extraRoutes
    // per registrare la route di test prima che createApp aggiunga l'handler errori.
    const app = createApp({}, (a) => {
      a.get('/api/__throw', () => {
        throw new AppError('bang', { status: 418, code: 'TEAPOT' });
      });
    });
    const res = await request(app).get('/api/__throw');
    expect(res.status).toBe(418);
    expect(res.body).toMatchObject({ error: { code: 'TEAPOT', message: 'bang' } });
  });
});
