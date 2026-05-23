import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { sessionsApi } from './sessions.api';

describe('sessionsApi', () => {
  it('list returns sessions array', async () => {
    server.use(
      http.get('http://localhost/api/sessions', () =>
        HttpResponse.json({
          sessions: [{ id: 'a', title: 'first', createdAt: 1, updatedAt: 2 }],
        }),
      ),
    );
    const out = await sessionsApi.list();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', title: 'first' });
  });

  it('list returns empty from default handler', async () => {
    const out = await sessionsApi.list();
    expect(out).toEqual([]);
  });

  it('create POSTs and returns new session', async () => {
    server.use(
      http.post('http://localhost/api/sessions', () =>
        HttpResponse.json(
          { id: 'NEW', title: '', createdAt: 100, updatedAt: 100 },
          { status: 201 },
        ),
      ),
    );
    const out = await sessionsApi.create();
    expect(out.id).toBe('NEW');
  });

  it('rename PATCHes and returns updated session', async () => {
    server.use(
      http.patch('http://localhost/api/sessions/:id', ({ params }) =>
        HttpResponse.json({ id: params.id, title: 'X', createdAt: 1, updatedAt: 2 }),
      ),
    );
    const out = await sessionsApi.rename('abc', 'X');
    expect(out.title).toBe('X');
  });

  it('rename throws on 400', async () => {
    server.use(
      http.patch('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 400 }),
      ),
    );
    await expect(sessionsApi.rename('abc', '')).rejects.toThrow(/bad/);
  });

  it('delete hits DELETE 204', async () => {
    let called = false;
    server.use(
      http.delete('http://localhost/api/sessions/:id', () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await sessionsApi.delete('abc');
    expect(called).toBe(true);
  });

  it('delete throws on 404', async () => {
    server.use(
      http.delete('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
    );
    await expect(sessionsApi.delete('nope')).rejects.toThrow();
  });

  it('exportSessionUrl returns the correct URL', () => {
    expect(sessionsApi.exportSessionUrl('abc')).toBe('/api/sessions/abc/export');
  });

  it('importSession POSTs JSON body and returns SessionMeta', async () => {
    const envelope = { version: 1, session: { id: 'x', title: 'T', createdAt: 1, updatedAt: 2 }, messages: [] };
    let capturedBody: unknown = null;
    server.use(
      http.post('http://localhost/api/sessions/import', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          { id: 'imp-1', title: 'Imported', createdAt: 10, updatedAt: 20 },
          { status: 201 },
        );
      }),
    );
    const meta = await sessionsApi.importSession(envelope);
    expect(capturedBody).toEqual(envelope);
    expect(meta).toMatchObject({ id: 'imp-1', title: 'Imported' });
  });

  it('importSession throws with server error message on non-2xx', async () => {
    server.use(
      http.post('http://localhost/api/sessions/import', () =>
        HttpResponse.json({ error: { message: 'nope' } }, { status: 400 }),
      ),
    );
    await expect(sessionsApi.importSession({})).rejects.toThrow(/nope/);
  });

  it('forkSession POSTs to /:id/fork with fromMessageId body and returns SessionMeta', async () => {
    let capturedBody: unknown = null;
    const forkedMeta = { id: 'forked-1', title: 'Fork', createdAt: 10, updatedAt: 20 };
    server.use(
      http.post('http://localhost/api/sessions/:id/fork', async ({ request, params }) => {
        expect(params.id).toBe('sess-1');
        capturedBody = await request.json();
        return HttpResponse.json({ meta: forkedMeta }, { status: 201 });
      }),
    );
    const meta = await sessionsApi.forkSession('sess-1', 'msg-42');
    expect(capturedBody).toEqual({ fromMessageId: 'msg-42' });
    expect(meta).toMatchObject({ id: 'forked-1', title: 'Fork' });
  });
});
