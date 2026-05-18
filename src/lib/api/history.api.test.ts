import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { historyApi } from './history.api';

describe('historyApi', () => {
  it('fetchDefault returns empty messages from default handler', async () => {
    const out = await historyApi.fetchDefault();
    expect(out).toEqual([]);
  });

  it('fetchDefault returns messages when populated', async () => {
    server.use(
      http.get('http://localhost/api/sessions/default', () =>
        HttpResponse.json({
          messages: [{ id: 'a', role: 'user', text: 'hi', timestamp: 1 }],
        }),
      ),
    );
    const out = await historyApi.fetchDefault();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', role: 'user' });
  });

  it('clearDefault hits DELETE', async () => {
    let called = false;
    server.use(
      http.delete('http://localhost/api/sessions/default', () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await historyApi.clearDefault();
    expect(called).toBe(true);
  });

  it('throws on 500', async () => {
    server.use(
      http.get('http://localhost/api/sessions/default', () =>
        HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
      ),
    );
    await expect(historyApi.fetchDefault()).rejects.toThrow(/boom/);
  });
});
