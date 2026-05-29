import { create } from 'zustand';
import { swarmsApi, type SwarmMeta, type SwarmInput } from '@/src/lib/api/swarms.api';

interface SwarmsState {
  list: SwarmMeta[];
  hydrated: boolean;
  error: string | null;
  init: () => Promise<void>;
  create: (input: SwarmInput) => Promise<void>;
  update: (id: string, input: Partial<SwarmInput>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useSwarmsStore = create<SwarmsState>((set, get) => ({
  list: [],
  hydrated: false,
  error: null,
  init: async () => {
    try {
      set({ list: await swarmsApi.list(), hydrated: true });
    } catch (e) {
      set({ hydrated: true, error: e instanceof Error ? e.message : 'load failed' });
    }
  },
  create: async (input) => {
    try {
      const meta = await swarmsApi.create(input);
      set({ list: [meta, ...get().list] });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'create failed' });
    }
  },
  update: async (id, input) => {
    try {
      const meta = await swarmsApi.update(id, input);
      set({ list: get().list.map((s) => (s.id === id ? meta : s)) });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'update failed' });
    }
  },
  remove: async (id) => {
    const prev = get().list;
    set({ list: prev.filter((s) => s.id !== id) });
    try {
      await swarmsApi.delete(id);
    } catch (e) {
      set({ list: prev, error: e instanceof Error ? e.message : 'delete failed' });
    }
  },
  clearError: () => set({ error: null }),
}));
