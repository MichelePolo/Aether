import { create } from 'zustand';
import { breakpointsApi } from '@/src/lib/api/breakpoints.api';
import type { BreakpointPolicy, CategoryMode, ToolCategory } from '@/src/types/breakpoints.types';

interface BreakpointsState {
  policy: BreakpointPolicy;
  loading: boolean;
  error: string | null;
  init(): Promise<void>;
  setCategoryMode(category: ToolCategory, mode: CategoryMode): Promise<void>;
  _reset(): void;
}

const initial = {
  policy: { safe: 'auto', dangerous: 'gate', external: 'gate' } as BreakpointPolicy,
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

const inflight = new Map<string, Promise<BreakpointPolicy>>();

export const useBreakpointsStore = create<BreakpointsState>((set) => ({
  ...initial,
  _reset: () => { inflight.clear(); set(initial); },
  init: async () => {
    set({ loading: true, error: null });
    try {
      const policy = await breakpointsApi.getPolicy();
      set({ policy, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },
  setCategoryMode: async (category, mode) => {
    const key = `${category}:${mode}`;
    const existing = inflight.get(key);
    if (existing) { await existing.catch(() => {}); return; }
    set({ loading: true, error: null });
    const promise = breakpointsApi.setCategoryMode(category, mode);
    inflight.set(key, promise);
    try {
      const policy = await promise;
      set({ policy, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    } finally {
      inflight.delete(key);
    }
  },
}));
