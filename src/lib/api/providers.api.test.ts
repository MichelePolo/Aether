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

  it('listKeys GETs /api/providers/keys and returns vault + info', async () => {
    const vault = [
      { transport: 'anthropic', hasKey: true, masked: 'sk-ant-****', updatedAt: 1000 },
      { transport: 'openai', hasKey: false, masked: null, updatedAt: null },
    ];
    const info = [
      { transport: 'anthropic-oauth', label: 'Anthropic OAuth', status: 'connected' },
    ];
    server.use(
      http.get('http://localhost/api/providers/keys', () =>
        HttpResponse.json({ vault, info }),
      ),
    );
    const result = await providersApi.listKeys();
    expect(result.vault).toHaveLength(2);
    expect(result.vault[0].transport).toBe('anthropic');
    expect(result.vault[0].hasKey).toBe(true);
    expect(result.info).toHaveLength(1);
    expect(result.info[0].transport).toBe('anthropic-oauth');
  });

  it('setKey PUTs to /api/providers/keys/:transport and returns row + status', async () => {
    const row = { transport: 'openai', hasKey: true, masked: 'sk-****', updatedAt: 2000 };
    const status = { transport: 'openai', state: 'ok', reason: 'Key stored' };
    let capturedBody: unknown;
    server.use(
      http.put('http://localhost/api/providers/keys/openai', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ row, status });
      }),
    );
    const result = await providersApi.setKey('openai', 'sk-test-key');
    expect(result.row.transport).toBe('openai');
    expect(result.row.hasKey).toBe(true);
    expect(result.status?.state).toBe('ok');
    expect((capturedBody as { key: string }).key).toBe('sk-test-key');
  });

  it('clearKey DELETEs /api/providers/keys/:transport and returns status', async () => {
    const status = { transport: 'anthropic', state: 'unconfigured', reason: 'Key removed' };
    server.use(
      http.delete('http://localhost/api/providers/keys/anthropic', () =>
        HttpResponse.json({ status }),
      ),
    );
    const result = await providersApi.clearKey('anthropic');
    expect(result.status?.transport).toBe('anthropic');
    expect(result.status?.state).toBe('unconfigured');
  });

  it('revealKey GETs /api/providers/keys/:transport?reveal=1 and returns plaintext', async () => {
    server.use(
      http.get('http://localhost/api/providers/keys/gemini', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('reveal') === '1') {
          return HttpResponse.json({ plaintext: 'AIza-secret-key' });
        }
        return HttpResponse.json({ error: { message: 'Missing reveal param' } }, { status: 400 });
      }),
    );
    const plaintext = await providersApi.revealKey('gemini');
    expect(plaintext).toBe('AIza-secret-key');
  });
});
