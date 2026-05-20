import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { providersApi } from './providers.api';

describe('providersApi', () => {
  it('list returns descriptors', async () => {
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [{
            name: 'fake:default',
            transport: 'fake',
            model: 'default',
            capabilities: { thinking: true, toolCalling: true },
            displayName: 'Fake (default)',
          }],
        }),
      ),
    );
    const list = await providersApi.list();
    expect(list[0].name).toBe('fake:default');
  });

  it('refresh re-fetches', async () => {
    server.use(
      http.post('http://localhost/api/providers/refresh', () =>
        HttpResponse.json({ providers: [] }),
      ),
    );
    const r = await providersApi.refresh();
    expect(r).toEqual([]);
  });

  it('defaultName returns the server default', async () => {
    server.use(
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'fake:default' }),
      ),
    );
    const n = await providersApi.defaultName();
    expect(n).toBe('fake:default');
  });
});
