import { create } from 'zustand';
import { gitApi } from '@/src/lib/api/git.api';
import type { WorkingChanges } from '@/src/lib/git-swimlanes';

interface GitChangesState {
  changes: WorkingChanges | null;
  selectedPath: string | null;
  selectedStaged: boolean;
  selectedDiff: string | null;
  message: string;
  loading: boolean;
  busy: boolean;
  error: string | null;
  activeWorkspaceId: string | null;
  load(workspaceId: string): Promise<void>;
  refresh(): Promise<void>;
  select(path: string, staged: boolean): Promise<void>;
  setMessage(message: string): void;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  discard(paths: string[]): Promise<void>;
  commit(): Promise<void>;
  commitAndPush(): Promise<void>;
  push(): Promise<void>;
  reset(): void;
}

function initial() {
  return {
    changes: null as WorkingChanges | null,
    selectedPath: null as string | null,
    selectedStaged: false,
    selectedDiff: null as string | null,
    message: '',
    loading: false,
    busy: false,
    error: null as string | null,
    activeWorkspaceId: null as string | null,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

export const useGitChangesStore = create<GitChangesState>((set, get) => ({
  ...initial(),

  load: async (workspaceId) => {
    set({ loading: true, error: null, activeWorkspaceId: workspaceId });
    try {
      const changes = await gitApi.changes(workspaceId);
      set({ changes, loading: false });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  refresh: async () => {
    const id = get().activeWorkspaceId;
    if (!id) return;
    try {
      set({ changes: await gitApi.changes(id), error: null });
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  select: async (path, staged) => {
    const id = get().activeWorkspaceId;
    if (!id) return;
    set({ selectedPath: path, selectedStaged: staged, selectedDiff: null });
    try {
      const { unified } = await gitApi.workingDiff(id, path, staged);
      // Ignore if the selection changed while loading.
      if (get().selectedPath === path && get().selectedStaged === staged) set({ selectedDiff: unified });
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  setMessage: (message) => set({ message }),

  stage: (paths) => mutate(set, get, () => gitApi.stage(get().activeWorkspaceId!, paths)),
  unstage: (paths) => mutate(set, get, () => gitApi.unstage(get().activeWorkspaceId!, paths)),
  discard: (paths) => mutate(set, get, () => gitApi.discard(get().activeWorkspaceId!, paths)),

  commit: () =>
    mutate(set, get, async () => {
      await gitApi.commit(get().activeWorkspaceId!, get().message);
      set({ message: '' });
    }),

  commitAndPush: () =>
    mutate(set, get, async () => {
      const id = get().activeWorkspaceId!;
      await gitApi.commit(id, get().message);
      set({ message: '' });
      await gitApi.push(id);
    }),

  push: () => mutate(set, get, () => gitApi.push(get().activeWorkspaceId!)),

  reset: () => set(initial()),
}));

async function mutate(
  set: (p: Partial<GitChangesState>) => void,
  get: () => GitChangesState,
  action: () => Promise<unknown>,
): Promise<void> {
  if (!get().activeWorkspaceId) return;
  set({ busy: true, error: null });
  try {
    await action();
    set({ changes: await gitApi.changes(get().activeWorkspaceId!) });
  } catch (e) {
    set({ error: errMsg(e) });
  } finally {
    set({ busy: false });
  }
}
