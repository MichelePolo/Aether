import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useOpenAIEndpointsStore } from './openaiEndpoints.store';
import { providersApi } from '@/src/lib/api/providers.api';
import type { OpenAICompatEndpoint } from '@/src/types/openai-endpoints.types';

const ep1: OpenAICompatEndpoint = {
  id: 'ep1', label: 'local vLLM', baseUrl: 'http://localhost:8000',
  model: 'mistral', headerKeys: [], createdAt: null, updatedAt: null,
};
const ep2: OpenAICompatEndpoint = {
  id: 'ep2', label: 'remote', baseUrl: 'http://gpu.lan:8000',
  model: null, headerKeys: ['Authorization'], createdAt: 1, updatedAt: 1,
};

beforeEach(() => {
  useOpenAIEndpointsStore.getState()._reset();
  vi.restoreAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('useOpenAIEndpointsStore', () => {
  it('init() loads endpoints', async () => {
    vi.spyOn(providersApi, 'listOpenAIEndpoints').mockResolvedValue([ep1, ep2]);
    await useOpenAIEndpointsStore.getState().init();
    expect(useOpenAIEndpointsStore.getState().endpoints).toHaveLength(2);
  });

  it('create() appends the new endpoint on success', async () => {
    vi.spyOn(providersApi, 'listOpenAIEndpoints').mockResolvedValue([ep1]);
    vi.spyOn(providersApi, 'createOpenAIEndpoint').mockResolvedValue({ endpoint: ep2, status: null });
    await useOpenAIEndpointsStore.getState().init();
    await useOpenAIEndpointsStore.getState().create({ label: 'remote', baseUrl: 'http://gpu.lan:8000' });
    expect(useOpenAIEndpointsStore.getState().endpoints.map((e) => e.id)).toContain('ep2');
  });

  it('create() surfaces an error and does not append', async () => {
    vi.spyOn(providersApi, 'listOpenAIEndpoints').mockResolvedValue([ep1]);
    vi.spyOn(providersApi, 'createOpenAIEndpoint').mockRejectedValue(new Error('already exists'));
    await useOpenAIEndpointsStore.getState().init();
    await useOpenAIEndpointsStore.getState().create({ label: 'dup', baseUrl: 'http://x' });
    expect(useOpenAIEndpointsStore.getState().error).toBe('already exists');
    expect(useOpenAIEndpointsStore.getState().endpoints).toHaveLength(1);
  });

  it('remove() optimistically drops the row then rolls back on error', async () => {
    vi.spyOn(providersApi, 'listOpenAIEndpoints').mockResolvedValue([ep1, ep2]);
    vi.spyOn(providersApi, 'deleteOpenAIEndpoint').mockRejectedValue(new Error('boom'));
    await useOpenAIEndpointsStore.getState().init();
    await useOpenAIEndpointsStore.getState().remove('ep2');
    expect(useOpenAIEndpointsStore.getState().endpoints.map((e) => e.id)).toContain('ep2'); // rolled back
    expect(useOpenAIEndpointsStore.getState().error).toBe('boom');
  });

  it('update() rolls back to previous list on error', async () => {
    vi.spyOn(providersApi, 'listOpenAIEndpoints').mockResolvedValue([ep1, ep2]);
    vi.spyOn(providersApi, 'updateOpenAIEndpoint').mockRejectedValue(new Error('conflict'));
    await useOpenAIEndpointsStore.getState().init();
    await useOpenAIEndpointsStore.getState().update('ep2', { label: 'renamed' });
    expect(useOpenAIEndpointsStore.getState().endpoints.find((e) => e.id === 'ep2')?.label).toBe('remote');
    expect(useOpenAIEndpointsStore.getState().error).toBe('conflict');
  });
});
