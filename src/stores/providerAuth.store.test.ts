import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useProviderAuthStore } from './providerAuth.store';
import { providersApi } from '@/src/lib/api/providers.api';

beforeEach(() => {
  useProviderAuthStore.getState()._reset();
});

const makeReport = (overrides: Partial<{ checkedAt: number }> = {}) => ({
  statuses: [
    { transport: 'anthropic' as const, state: 'ok' as const, reason: 'Key found' },
    { transport: 'openai' as const, state: 'unconfigured' as const, reason: 'No key' },
  ],
  checkedAt: overrides.checkedAt ?? 1000,
});

describe('useProviderAuthStore', () => {
  it('init() populates statuses + checkedAt and clears loading', async () => {
    const report = makeReport({ checkedAt: 5000 });
    server.use(
      http.get('http://localhost/api/providers/auth-status', () =>
        HttpResponse.json(report),
      ),
    );
    await useProviderAuthStore.getState().init();
    const state = useProviderAuthStore.getState();
    expect(state.statuses).toHaveLength(2);
    expect(state.checkedAt).toBe(5000);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('refresh() re-fetches all statuses and replaces them', async () => {
    const report = makeReport({ checkedAt: 9999 });
    server.use(
      http.post('http://localhost/api/providers/auth-status/refresh', () =>
        HttpResponse.json(report),
      ),
    );
    await useProviderAuthStore.getState().refresh();
    const state = useProviderAuthStore.getState();
    expect(state.statuses).toHaveLength(2);
    expect(state.checkedAt).toBe(9999);
    expect(state.loading).toBe(false);
  });

  it("refresh('anthropic') POSTs with transport=anthropic query param", async () => {
    let capturedUrl = '';
    const report = makeReport();
    server.use(
      http.post('http://localhost/api/providers/auth-status/refresh', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(report);
      }),
    );
    await useProviderAuthStore.getState().refresh('anthropic');
    expect(capturedUrl).toContain('transport=anthropic');
  });

  it('dedupe: two simultaneous refresh("anthropic") calls only fire one POST', async () => {
    const report = makeReport();
    let callCount = 0;
    server.use(
      http.post('http://localhost/api/providers/auth-status/refresh', () => {
        callCount += 1;
        return HttpResponse.json(report);
      }),
    );
    // Fire both simultaneously without awaiting the first
    const p1 = useProviderAuthStore.getState().refresh('anthropic');
    const p2 = useProviderAuthStore.getState().refresh('anthropic');
    await Promise.all([p1, p2]);
    expect(callCount).toBe(1);
  });

  it('network failure populates error and sets loading to false', async () => {
    vi.spyOn(providersApi, 'fetchAuthStatus').mockRejectedValueOnce(new Error('Network down'));
    await useProviderAuthStore.getState().init();
    const state = useProviderAuthStore.getState();
    expect(state.error).toBe('Network down');
    expect(state.loading).toBe(false);
  });
});
