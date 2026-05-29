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
    body: { sessionId: string; message: string },
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface TddRunnerDeps {
  runCommand: (command: string, cwd?: string) => Promise<CommandResult>;
  subAgentsStore: { list(): Promise<{ name: string }[]> };
  dispatcher: TddDispatcher;
  createSession: () => Promise<string>;
}
