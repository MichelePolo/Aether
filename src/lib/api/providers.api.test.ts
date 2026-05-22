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

  it('fetchAuthStatus GETs and returns parsed report', async () => {
    const report = {
      statuses: [
        { transport: 'anthropic', state: 'ok', reason: 'API key present' },
        { transport: 'openai', state: 'unconfigured', reason: 'No API key' },
      ],
      checkedAt: 1234567890,
    };
    server.use(
      http.get('http://localhost/api/providers/auth-status', () =>
        HttpResponse.json(report),
      ),
    );
    const result = await providersApi.fetchAuthStatus();
    expect(result.statuses).toHaveLength(2);
    expect(result.checkedAt).toBe(1234567890);
    expect(result.statuses[0].transport).toBe('anthropic');
  });

  it('refreshAuthStatus POSTs without transport= query when no transport given', async () => {
    let capturedUrl = '';
    const report = { statuses: [], checkedAt: 9999 };
    server.use(
      http.post('http://localhost/api/providers/auth-status/refresh', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(report);
      }),
    );
    const result = await providersApi.refreshAuthStatus();
    expect(result.checkedAt).toBe(9999);
    expect(capturedUrl).not.toContain('transport=');
  });

  it('refreshAuthStatus POSTs WITH transport=openai query when transport given', async () => {
    let capturedUrl = '';
    const report = {
      statuses: [{ transport: 'openai', state: 'ok', reason: 'Key found' }],
      checkedAt: 8888,
    };
    server.use(
      http.post('http://localhost/api/providers/auth-status/refresh', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(report);
      }),
    );
    const result = await providersApi.refreshAuthStatus('openai');
    expect(result.checkedAt).toBe(8888);
    expect(capturedUrl).toContain('transport=openai');
  });
});
