import { create } from 'zustand';
import { providersApi } from '@/src/lib/api/providers.api';
import type { OllamaEndpoint } from '@/src/types/ollama-endpoints.types';
import { useProvidersStore } from './providers.store';
import { useProviderAuthStore } from './providerAuth.store';

interface OllamaEndpointsState {
  endpoints: OllamaEndpoint[];
  loading: boolean;
  error: string | null;
  init(): Promise<void>;
  create(input: { label: string; baseUrl: string; token?: string }): Promise<void>;
  update(id: string, patch: { label?: string; baseUrl?: string; token?: string | null }): Promise<void>;
  remove(id: string): Promise<void>;
  _reset(): void;
}

const initial = {
  endpoints: [] as OllamaEndpoint[],
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

function syncProviders(): void {
  void useProvidersStore.getState().init();
  void useProviderAuthStore.getState().refresh('ollama');
}

export const useOllamaEndpointsStore = create<OllamaEndpointsState>((set, get) => ({
  ...initial,

  _reset: () => set(initial),

  init: async () => {
    set({ loading: true, error: null });
    try {
      const endpoints = await providersApi.listOllamaEndpoints();
      set({ endpoints, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  create: async (input) => {
    set({ loading: true, error: null });
    try {
      const { endpoint } = await providersApi.createOllamaEndpoint(input);
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
      const { endpoint } = await providersApi.updateOllamaEndpoint(id, patch);
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
      await providersApi.deleteOllamaEndpoint(id);
      syncProviders();
    } catch (e) {
      set({ endpoints: prev, error: errMsg(e) });
    }
  },
}));
