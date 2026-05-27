import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useOllamaEndpointsStore } from './ollamaEndpoints.store';
import { providersApi } from '@/src/lib/api/providers.api';
import type { OllamaEndpoint } from '@/src/types/ollama-endpoints.types';

const local: OllamaEndpoint = {
  id: 'local', label: 'local', baseUrl: 'http://localhost:11434',
  hasToken: false, tokenMasked: null, fixed: true, createdAt: null, updatedAt: null,
};
const gpu: OllamaEndpoint = {
  id: 'abc', label: 'gpu', baseUrl: 'http://gpu.lan:11434',
  hasToken: false, tokenMasked: null, fixed: false, createdAt: 1, updatedAt: 1,
};

beforeEach(() => {
  useOllamaEndpointsStore.getState()._reset();
  vi.restoreAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('useOllamaEndpointsStore', () => {
  it('init() loads endpoints', async () => {
    vi.spyOn(providersApi, 'listOllamaEndpoints').mockResolvedValue([local, gpu]);
    await useOllamaEndpointsStore.getState().init();
    expect(useOllamaEndpointsStore.getState().endpoints).toHaveLength(2);
  });

  it('create() appends the new endpoint on success', async () => {
    vi.spyOn(providersApi, 'listOllamaEndpoints').mockResolvedValue([local]);
    vi.spyOn(providersApi, 'createOllamaEndpoint').mockResolvedValue({ endpoint: gpu, status: null });
    await useOllamaEndpointsStore.getState().init();
    await useOllamaEndpointsStore.getState().create({ label: 'gpu', baseUrl: 'http://gpu.lan:11434' });
    expect(useOllamaEndpointsStore.getState().endpoints.map((e) => e.id)).toContain('abc');
  });

  it('create() surfaces an error and does not append', async () => {
    vi.spyOn(providersApi, 'listOllamaEndpoints').mockResolvedValue([local]);
    vi.spyOn(providersApi, 'createOllamaEndpoint').mockRejectedValue(new Error('already exists'));
    await useOllamaEndpointsStore.getState().init();
    await useOllamaEndpointsStore.getState().create({ label: 'dup', baseUrl: 'http://x' });
    expect(useOllamaEndpointsStore.getState().error).toBe('already exists');
    expect(useOllamaEndpointsStore.getState().endpoints).toHaveLength(1);
  });

  it('remove() optimistically drops the row then rolls back on error', async () => {
    vi.spyOn(providersApi, 'listOllamaEndpoints').mockResolvedValue([local, gpu]);
    vi.spyOn(providersApi, 'deleteOllamaEndpoint').mockRejectedValue(new Error('boom'));
    await useOllamaEndpointsStore.getState().init();
    await useOllamaEndpointsStore.getState().remove('abc');
    expect(useOllamaEndpointsStore.getState().endpoints.map((e) => e.id)).toContain('abc'); // rolled back
    expect(useOllamaEndpointsStore.getState().error).toBe('boom');
  });

  it('update() rolls back to previous list on error', async () => {
    vi.spyOn(providersApi, 'listOllamaEndpoints').mockResolvedValue([local, gpu]);
    vi.spyOn(providersApi, 'updateOllamaEndpoint').mockRejectedValue(new Error('conflict'));
    await useOllamaEndpointsStore.getState().init();
    await useOllamaEndpointsStore.getState().update('abc', { label: 'renamed' });
    expect(useOllamaEndpointsStore.getState().endpoints.find((e) => e.id === 'abc')?.label).toBe('gpu');
    expect(useOllamaEndpointsStore.getState().error).toBe('conflict');
  });
});
