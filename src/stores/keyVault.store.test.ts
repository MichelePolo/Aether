import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useKeyVaultStore } from './keyVault.store';
import { useProvidersStore } from './providers.store';
import { useProviderAuthStore } from './providerAuth.store';
import type { MaskedKeyRow, ReadonlyInfoRow } from '@/src/types/key-vault.types';

const makeVaultRow = (overrides: Partial<MaskedKeyRow> = {}): MaskedKeyRow => ({
  transport: 'anthropic',
  hasKey: false,
  masked: null,
  updatedAt: null,
  ...overrides,
});

const makeInfoRow = (overrides: Partial<ReadonlyInfoRow> = {}): ReadonlyInfoRow => ({
  transport: 'anthropic-oauth',
  label: 'Anthropic OAuth',
  status: 'not-connected',
  ...overrides,
});

beforeEach(() => {
  useKeyVaultStore.getState()._reset();
  vi.restoreAllMocks();
});

describe('useKeyVaultStore', () => {
  it('init() populates vault + info and clears loading', async () => {
    const vault: MaskedKeyRow[] = [
      makeVaultRow({ transport: 'anthropic', hasKey: true, masked: 'sk-ant-****', updatedAt: 1000 }),
      makeVaultRow({ transport: 'openai', hasKey: false, masked: null, updatedAt: null }),
      makeVaultRow({ transport: 'gemini', hasKey: false, masked: null, updatedAt: null }),
    ];
    const info: ReadonlyInfoRow[] = [
      makeInfoRow({ transport: 'anthropic-oauth', label: 'Anthropic OAuth', status: 'connected' }),
    ];
    server.use(
      http.get('http://localhost/api/providers/keys', () =>
        HttpResponse.json({ vault, info }),
      ),
    );
    await useKeyVaultStore.getState().init();
    const state = useKeyVaultStore.getState();
    expect(state.vault).toHaveLength(3);
    expect(state.vault[0].transport).toBe('anthropic');
    expect(state.vault[0].hasKey).toBe(true);
    expect(state.info).toHaveLength(1);
    expect(state.info[0].transport).toBe('anthropic-oauth');
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('save() PUTs, replaces the row in vault, and calls cross-store refreshes', async () => {
    const existingVault: MaskedKeyRow[] = [
      makeVaultRow({ transport: 'openai', hasKey: false, masked: null, updatedAt: null }),
    ];
    server.use(
      http.get('http://localhost/api/providers/keys', () =>
        HttpResponse.json({ vault: existingVault, info: [] }),
      ),
    );
    await useKeyVaultStore.getState().init();

    const updatedRow = makeVaultRow({ transport: 'openai', hasKey: true, masked: 'sk-****', updatedAt: 2000 });
    server.use(
      http.put('http://localhost/api/providers/keys/openai', () =>
        HttpResponse.json({
          row: updatedRow,
          status: { transport: 'openai', state: 'ok', reason: 'Key stored' },
        }),
      ),
    );

    const providersInitSpy = vi.spyOn(useProvidersStore.getState(), 'init').mockResolvedValue();
    const authRefreshSpy = vi.spyOn(useProviderAuthStore.getState(), 'refresh').mockResolvedValue();

    await useKeyVaultStore.getState().save('openai', 'sk-test-key');

    const state = useKeyVaultStore.getState();
    const row = state.vault.find((r) => r.transport === 'openai');
    expect(row?.hasKey).toBe(true);
    expect(row?.masked).toBe('sk-****');
    expect(providersInitSpy).toHaveBeenCalledOnce();
    expect(authRefreshSpy).toHaveBeenCalledWith('openai');
  });

  it('save() on network error sets error state', async () => {
    server.use(
      http.put('http://localhost/api/providers/keys/gemini', () =>
        HttpResponse.json({ error: { message: 'Internal server error' } }, { status: 500 }),
      ),
    );
    await useKeyVaultStore.getState().save('gemini', 'AIza-bad-key');
    const state = useKeyVaultStore.getState();
    expect(state.error).toBe('Internal server error');
    expect(state.loading).toBe(false);
  });

  it('clear() DELETEs and marks hasKey:false in vault', async () => {
    const existingVault: MaskedKeyRow[] = [
      makeVaultRow({ transport: 'anthropic', hasKey: true, masked: 'sk-ant-****', updatedAt: 1000 }),
    ];
    server.use(
      http.get('http://localhost/api/providers/keys', () =>
        HttpResponse.json({ vault: existingVault, info: [] }),
      ),
    );
    await useKeyVaultStore.getState().init();

    server.use(
      http.delete('http://localhost/api/providers/keys/anthropic', () =>
        HttpResponse.json({
          status: { transport: 'anthropic', state: 'unconfigured', reason: 'Key removed' },
        }),
      ),
    );

    vi.spyOn(useProvidersStore.getState(), 'init').mockResolvedValue();
    vi.spyOn(useProviderAuthStore.getState(), 'refresh').mockResolvedValue();

    await useKeyVaultStore.getState().clear('anthropic');

    const state = useKeyVaultStore.getState();
    const row = state.vault.find((r) => r.transport === 'anthropic');
    expect(row?.hasKey).toBe(false);
    expect(row?.masked).toBeNull();
  });

  it('reveal() returns plaintext and does NOT store it in state', async () => {
    server.use(
      http.get('http://localhost/api/providers/keys/anthropic', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('reveal') === '1') {
          return HttpResponse.json({ plaintext: 'sk-secret-revealed' });
        }
        return HttpResponse.json({ error: { message: 'Missing reveal param' } }, { status: 400 });
      }),
    );
    const plaintext = await useKeyVaultStore.getState().reveal('anthropic');
    expect(plaintext).toBe('sk-secret-revealed');
    // Must NOT leak plaintext into store state
    const state = useKeyVaultStore.getState();
    expect(JSON.stringify(state).includes('sk-secret-revealed')).toBe(false);
  });

  it('dedupe: two simultaneous save("openai", ...) only fire one PUT', async () => {
    let callCount = 0;
    const updatedRow = makeVaultRow({ transport: 'openai', hasKey: true, masked: 'sk-****', updatedAt: 3000 });
    server.use(
      http.put('http://localhost/api/providers/keys/openai', () => {
        callCount += 1;
        return HttpResponse.json({
          row: updatedRow,
          status: { transport: 'openai', state: 'ok', reason: 'Key stored' },
        });
      }),
    );

    vi.spyOn(useProvidersStore.getState(), 'init').mockResolvedValue();
    vi.spyOn(useProviderAuthStore.getState(), 'refresh').mockResolvedValue();

    const p1 = useKeyVaultStore.getState().save('openai', 'sk-key-1');
    const p2 = useKeyVaultStore.getState().save('openai', 'sk-key-2');
    await Promise.all([p1, p2]);
    expect(callCount).toBe(1);
  });
});
