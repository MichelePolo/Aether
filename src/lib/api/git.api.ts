import type { CommitNode, DiffRequest, DiffResult, WorkingChanges } from '@/src/lib/git-swimlanes';

export interface GitStatus {
  isRepo: boolean;
  root?: string;
  head?: string;
}

export interface GitLogResult {
  commits: CommitNode[];
  truncated: boolean;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function okOrThrow(res: Response): Promise<void> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
}

export const gitApi = {
  status: async (workspaceId: string): Promise<GitStatus> =>
    jsonOrThrow<GitStatus>(
      await fetch(`/api/git/status?workspaceId=${encodeURIComponent(workspaceId)}`),
    ),

  log: async (workspaceId: string, maxCount?: number): Promise<GitLogResult> => {
    let url = `/api/git/log?workspaceId=${encodeURIComponent(workspaceId)}`;
    if (maxCount !== undefined) url += `&maxCount=${maxCount}`;
    return jsonOrThrow<GitLogResult>(await fetch(url));
  },

  diff: async (req: DiffRequest & { workspaceId: string }): Promise<DiffResult> => {
    let url =
      `/api/git/diff?workspaceId=${encodeURIComponent(req.workspaceId)}` +
      `&hash=${encodeURIComponent(req.hash)}` +
      `&path=${encodeURIComponent(req.path)}`;
    if (req.oldPath !== undefined) url += `&oldPath=${encodeURIComponent(req.oldPath)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return { unified: await res.text() };
  },

  changes: async (workspaceId: string): Promise<WorkingChanges> =>
    jsonOrThrow<WorkingChanges>(
      await fetch(`/api/git/changes?workspaceId=${encodeURIComponent(workspaceId)}`),
    ),

  workingDiff: async (workspaceId: string, path: string, staged?: boolean): Promise<DiffResult> => {
    let url = `/api/git/working-diff?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}`;
    if (staged) url += `&staged=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return { unified: await res.text() };
  },

  stage: async (workspaceId: string, paths: string[]): Promise<void> =>
    okOrThrow(await postJson('/api/git/stage', { workspaceId, paths })),

  unstage: async (workspaceId: string, paths: string[]): Promise<void> =>
    okOrThrow(await postJson('/api/git/unstage', { workspaceId, paths })),

  discard: async (workspaceId: string, paths: string[]): Promise<void> =>
    okOrThrow(await postJson('/api/git/discard', { workspaceId, paths })),

  commit: async (workspaceId: string, message: string): Promise<{ head: string }> =>
    jsonOrThrow<{ head: string }>(await postJson('/api/git/commit', { workspaceId, message })),

  push: async (workspaceId: string): Promise<{ stdout: string }> =>
    jsonOrThrow<{ stdout: string }>(await postJson('/api/git/push', { workspaceId })),
};
