import { create } from 'zustand';
import { subagentsApi, type SubAgentCreateInput, type SubAgentUpdateInput } from '@/src/lib/api/subagents.api';
import type { SubAgentMeta } from '@/src/types/subagent.types';

interface SubAgentsState {
  list: SubAgentMeta[];
  hydrated: boolean;
  error: string | null;

  init: () => Promise<void>;
  create: (input: SubAgentCreateInput) => Promise<SubAgentMeta>;
  update: (id: string, input: SubAgentUpdateInput) => Promise<void>;
  delete: (id: string) => Promise<void>;
  clearError: () => void;
  _reset: () => void;
}

const initial = {
  list: [] as SubAgentMeta[],
  hydrated: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

export const useSubAgentsStore = create<SubAgentsState>((set) => ({
  ...initial,
  _reset: () => set(initial),

  init: async () => {
    try {
      const list = await subagentsApi.list();
      set({ list, hydrated: true, error: null });
    } catch (e) {
      set({ list: [], hydrated: true, error: errMsg(e) });
    }
  },

  create: async (input) => {
    try {
      const meta = await subagentsApi.create(input);
      set((s) => ({ list: [meta, ...s.list], error: null }));
      return meta;
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  update: async (id, input) => {
    try {
      const meta = await subagentsApi.update(id, input);
      set((s) => ({
        list: s.list.map((m) => (m.id === id ? meta : m)),
        error: null,
      }));
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  delete: async (id) => {
    try {
      await subagentsApi.delete(id);
      set((s) => ({ list: s.list.filter((m) => m.id !== id), error: null }));
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  clearError: () => set({ error: null }),
}));
