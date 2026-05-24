import { create } from 'zustand';
import { workspacesApi } from '@/src/lib/api/workspaces.api';
import type { Workspace } from '@/src/types/workspace.types';

interface WorkspacesState {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  init(): Promise<void>;
  create(input: { name: string; rootPath: string }): Promise<Workspace>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  _reset(): void;
}

const initial = {
  workspaces: [] as Workspace[],
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

const inflight = new Map<string, Promise<unknown>>();

export const useWorkspacesStore = create<WorkspacesState>((set) => ({
  ...initial,
  _reset: () => { inflight.clear(); set(initial); },
  init: async () => {
    set({ loading: true, error: null });
    try {
      const workspaces = await workspacesApi.list();
      set({ workspaces, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },
  create: async (input) => {
    set({ loading: true, error: null });
    try {
      const w = await workspacesApi.create(input);
      set((s) => ({ workspaces: [...s.workspaces, w], loading: false }));
      return w;
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
      throw e;
    }
  },
  rename: async (id, name) => {
    const key = `rename:${id}`;
    const existing = inflight.get(key);
    if (existing) { await existing.catch(() => {}); return; }
    const promise = workspacesApi.rename(id, name);
    inflight.set(key, promise);
    try {
      const updated = await promise;
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name: updated.name } : w)),
      }));
    } catch (e) {
      set({ error: errMsg(e) });
    } finally {
      inflight.delete(key);
    }
  },
  remove: async (id) => {
    try {
      await workspacesApi.remove(id);
    } catch {
      // Idempotent: still remove locally if the server says it's gone.
    }
    set((s) => ({ workspaces: s.workspaces.filter((w) => w.id !== id) }));
  },
}));
