// Re-export the shared pure git-swimlanes types so backend code imports them
// from a single place.
export type {
  FileStatusCode,
  FileChange,
  CommitNode,
  LaneModel,
  DiffRequest,
  DiffResult,
  PullRequestRef,
  SwimlanesOptions,
} from '@/src/lib/git-swimlanes';

// Backend-only types.
export interface GitRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface GitStatus {
  isRepo: boolean;
  root?: string;
  head?: string;
}

export const GIT_DEFAULTS = { timeoutMs: 15_000, maxTimeoutMs: 30_000 } as const;
export const GIT_REMOTE_DEFAULTS = { timeoutMs: 60_000, maxTimeoutMs: 120_000 } as const;
