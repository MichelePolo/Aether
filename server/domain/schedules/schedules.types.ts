import type { Cadence } from './next-run';

export type { Cadence };

export type Target =
  | { kind: 'prompt'; prompt: string; subAgent?: string }
  | { kind: 'swarm'; swarmId: string; input?: string };

export type Autonomy = 'safe' | 'trusted';
export type RunStatus = 'running' | 'success' | 'error' | 'rejected';

export interface Schedule {
  id: string;
  name: string;
  cadence: Cadence;
  target: Target;
  autonomy: Autonomy;
  providerName?: string;
  workspaceId?: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  sessionId: string | null;
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  error?: string;
}

export interface ScheduleInput {
  name: string;
  cadence: Cadence;
  target: Target;
  autonomy?: Autonomy;
  providerName?: string;
  workspaceId?: string;
  enabled?: boolean;
}
