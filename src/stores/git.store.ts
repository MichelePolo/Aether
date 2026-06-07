import { create } from 'zustand';
import { gitApi, type GitStatus } from '@/src/lib/api/git.api';
import type { CommitNode } from '@/src/lib/git-swimlanes';

interface GitState {
  status: GitStatus | null;
  commits: CommitNode[];
  truncated: boolean;
  loading: boolean;
  error: string | null;
  expanded: Set<string>;
  activeWorkspaceId: string | null;
  load(workspaceId: string, maxCount?: number): Promise<void>;
  toggleExpand(hash: string): void;
  refresh(): Promise<void>;
  reset(): void;
}

function initial() {
  return {
    status: null as GitStatus | null,
    commits: [] as CommitNode[],
    truncated: false,
    loading: false,
    error: null as string | null,
    expanded: new Set<string>(),
    activeWorkspaceId: null as string | null,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

export const useGitStore = create<GitState>((set, get) => ({
  ...initial(),
  load: async (workspaceId, maxCount) => {
    set({ loading: true, error: null, activeWorkspaceId: workspaceId });
    try {
      const status = await gitApi.status(workspaceId);
      if (!status.isRepo) {
        set({ status, commits: [], truncated: false, loading: false });
        return;
      }
      const { commits, truncated } = await gitApi.log(workspaceId, maxCount);
      set({ status, commits, truncated, loading: false });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },
  toggleExpand: (hash) => {
    set((s) => {
      const next = new Set(s.expanded);
      next.has(hash) ? next.delete(hash) : next.add(hash);
      return { expanded: next };
    });
  },
  refresh: async () => {
    const id = get().activeWorkspaceId;
    if (id) await get().load(id);
  },
  reset: () => set(initial()),
}));
