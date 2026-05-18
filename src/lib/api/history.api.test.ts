import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { historyApi } from './history.api';

describe('historyApi', () => {
  it('fetchById returns messages from default handler', async () => {
    const out = await historyApi.fetchById('msw-session-1');
    expect(out).toEqual([]);
  });

  it('fetchById returns populated messages', async () => {
    server.use(
      http.get('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({
          messages: [{ id: 'a', role: 'user', text: 'hi', timestamp: 1 }],
        }),
      ),
    );
    const out = await historyApi.fetchById('any');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', role: 'user' });
  });

  it('fetchById throws on 404', async () => {
    server.use(
      http.get('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
    );
    await expect(historyApi.fetchById('nope')).rejects.toThrow();
  });

  it('fetchById throws on 500', async () => {
    server.use(
      http.get('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
      ),
    );
    await expect(historyApi.fetchById('any')).rejects.toThrow(/boom/);
  });
});
