import type { CommitNode, DiffRequest, DiffResult } from '@/src/lib/git-swimlanes';

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
};
