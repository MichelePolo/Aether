import { create } from 'zustand';
import { schedulesApi, type Schedule, type ScheduleInput } from '@/src/lib/api/schedules.api';

interface SchedulesState {
  list: Schedule[];
  hydrated: boolean;
  error: string | null;
  init: () => Promise<void>;
  create: (input: ScheduleInput) => Promise<void>;
  update: (id: string, input: Partial<ScheduleInput>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useSchedulesStore = create<SchedulesState>((set, get) => ({
  list: [], hydrated: false, error: null,
  init: async () => {
    try { set({ list: await schedulesApi.list(), hydrated: true }); }
    catch (e) { set({ hydrated: true, error: e instanceof Error ? e.message : 'load failed' }); }
  },
  create: async (input) => {
    try { set({ list: [await schedulesApi.create(input), ...get().list] }); }
    catch (e) { set({ error: e instanceof Error ? e.message : 'create failed' }); }
  },
  update: async (id, input) => {
    try { const s = await schedulesApi.update(id, input); set({ list: get().list.map((x) => (x.id === id ? s : x)) }); }
    catch (e) { set({ error: e instanceof Error ? e.message : 'update failed' }); }
  },
  remove: async (id) => {
    const prev = get().list;
    set({ list: prev.filter((x) => x.id !== id) });
    try { await schedulesApi.remove(id); }
    catch (e) { set({ list: prev, error: e instanceof Error ? e.message : 'delete failed' }); }
  },
  runNow: async (id) => {
    try { await schedulesApi.runNow(id); }
    catch (e) { set({ error: e instanceof Error ? e.message : 'run failed' }); }
  },
  clearError: () => set({ error: null }),
}));
