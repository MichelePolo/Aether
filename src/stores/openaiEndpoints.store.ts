import { create } from 'zustand';
import { providersApi } from '@/src/lib/api/providers.api';
import type { OpenAICompatEndpoint } from '@/src/types/openai-endpoints.types';
import { useProvidersStore } from './providers.store';
import { useProviderAuthStore } from './providerAuth.store';

interface OpenAIEndpointsState {
  endpoints: OpenAICompatEndpoint[];
  loading: boolean;
  error: string | null;
  init(): Promise<void>;
  create(input: { label: string; baseUrl: string; model?: string; headers?: Record<string, string> }): Promise<void>;
  update(id: string, patch: { label?: string; baseUrl?: string; model?: string | null; headers?: Record<string, string> | null }): Promise<void>;
  remove(id: string): Promise<void>;
  _reset(): void;
}

const initial = {
  endpoints: [] as OpenAICompatEndpoint[],
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

function syncProviders(): void {
  void useProvidersStore.getState().init();
  void useProviderAuthStore.getState().refresh('openai-compat');
}

export const useOpenAIEndpointsStore = create<OpenAIEndpointsState>((set, get) => ({
  ...initial,

  _reset: () => set(initial),

  init: async () => {
    set({ loading: true, error: null });
    try {
      const endpoints = await providersApi.listOpenAIEndpoints();
      set({ endpoints, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  create: async (input) => {
    set({ loading: true, error: null });
    try {
      const { endpoint } = await providersApi.createOpenAIEndpoint(input);
      set((s) => ({ endpoints: [...s.endpoints, endpoint], loading: false, error: null }));
      syncProviders();
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  update: async (id, patch) => {
    const prev = get().endpoints;
    set({ loading: true, error: null });
    try {
      const { endpoint } = await providersApi.updateOpenAIEndpoint(id, patch);
      set((s) => ({
        endpoints: s.endpoints.map((e) => (e.id === id ? endpoint : e)),
        loading: false,
        error: null,
      }));
      syncProviders();
    } catch (e) {
      set({ endpoints: prev, loading: false, error: errMsg(e) });
    }
  },

  remove: async (id) => {
    const prev = get().endpoints;
    set((s) => ({ endpoints: s.endpoints.filter((e) => e.id !== id), error: null }));
    try {
      await providersApi.deleteOpenAIEndpoint(id);
      syncProviders();
    } catch (e) {
      set({ endpoints: prev, error: errMsg(e) });
    }
  },
}));
