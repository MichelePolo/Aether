import type { SseEmitter } from '@/server/lib/sse';

export type TddRunStatus =
  | 'success'
  | 'already_green'
  | 'max_retries_exceeded'
  | 'error'
  | 'interrupted';

export interface CommandResult {
  exitCode: number;
  output: string;
}

export interface TddRunOpts {
  command: string;
  subAgentName: string;
  maxRetries?: number;
  cwd?: string;
}

export interface TddDispatcher {
  handle(
    body: { sessionId: string; message: string; workspaceId?: string },
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface TddRunnerDeps {
  runCommand: (command: string, cwd?: string, signal?: AbortSignal) => Promise<CommandResult>;
  subAgentsStore: { list(): Promise<{ name: string }[]> };
  dispatcher: TddDispatcher;
  resolveWorkspaceId?: (cwd: string | undefined) => string;
  resolveCwd?: (cwd?: string) => string;
  createSession: (cwd?: string) => Promise<string>;
}
