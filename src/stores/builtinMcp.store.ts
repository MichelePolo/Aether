import { create } from 'zustand';
import { builtinMcpApi } from '@/src/lib/api/builtin-mcp.api';
import { useMcpStore } from './mcp.store';
import type { BuiltinTransport, BuiltinMcpState } from '@/src/types/mcp.types';

interface BuiltinMcpStoreState {
  builtins: BuiltinMcpState[];
  loading: boolean;
  error: string | null;

  init(): Promise<void>;
  toggle(transport: BuiltinTransport): Promise<void>;
  setFsRoot(transport: BuiltinTransport, root: string | null): Promise<void>;
  _reset(): void;
}

const initial = {
  builtins: [] as BuiltinMcpState[],
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

const inflight = new Map<string, Promise<BuiltinMcpState>>();

export const useBuiltinMcpStore = create<BuiltinMcpStoreState>((set, get) => ({
  ...initial,
  _reset: () => { inflight.clear(); set(initial); },

  init: async () => {
    set({ loading: true, error: null });
    try {
      const builtins = await builtinMcpApi.list();
      set({ builtins, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  toggle: async (transport) => {
    const key = `toggle:${transport}`;
    const existing = inflight.get(key);
    if (existing) { await existing.catch(() => {}); return; }
    const current = get().builtins.find((b) => b.transport === transport);
    if (!current) return;
    const newEnabled = !current.enabled;
    const promise = builtinMcpApi.set(transport, { enabled: newEnabled });
    inflight.set(key, promise);
    try {
      const state = await promise;
      set((s) => ({
        builtins: s.builtins.map((b) => (b.transport === transport ? state : b)),
        error: null,
      }));
      void useMcpStore.getState().refresh();
    } catch (e) {
      set({ error: errMsg(e) });
    } finally {
      inflight.delete(key);
    }
  },

  setFsRoot: async (transport, root) => {
    const key = `fsroot:${transport}`;
    const existing = inflight.get(key);
    if (existing) { await existing.catch(() => {}); return; }
    const promise = builtinMcpApi.set(transport, { fsRoot: root });
    inflight.set(key, promise);
    try {
      const state = await promise;
      set((s) => ({
        builtins: s.builtins.map((b) => (b.transport === transport ? state : b)),
        error: null,
      }));
      void useMcpStore.getState().refresh();
    } catch (e) {
      set({ error: errMsg(e) });
    } finally {
      inflight.delete(key);
    }
  },
}));
