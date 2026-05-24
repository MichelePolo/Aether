import type { Workspace, BrowseEntry } from '@/src/types/workspace.types';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export const workspacesApi = {
  list: async (): Promise<Workspace[]> => {
    const r = await jsonOrThrow<{ workspaces: Workspace[] }>(await fetch('/api/workspaces'));
    return r.workspaces;
  },

  create: async (input: { name: string; rootPath: string }): Promise<Workspace> =>
    jsonOrThrow<Workspace>(
      await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    ),

  rename: async (id: string, name: string): Promise<Workspace> =>
    jsonOrThrow<Workspace>(
      await fetch(`/api/workspaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    ),

  remove: async (id: string): Promise<void> => {
    const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  },

  browse: async (path?: string): Promise<BrowseEntry[]> => {
    const qs = path ? `?path=${encodeURIComponent(path)}` : '';
    const r = await jsonOrThrow<{ entries: BrowseEntry[] }>(
      await fetch(`/api/workspaces/browse${qs}`),
    );
    return r.entries;
  },

  activateForSession: async (sessionId: string): Promise<{ rooted: string | null }> =>
    jsonOrThrow<{ rooted: string | null }>(
      await fetch('/api/workspaces/activate-for-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }),
    ),
};
