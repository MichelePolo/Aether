export interface SwarmStep {
  subAgentName: string;
  promptTemplate: string;
  pauseAfter: boolean;
  /** Optional provider override (transport:model). Undefined = inherit. */
  providerName?: string;
  /** Per-step workspace override. Undefined = inherit swarm-level default. */
  workspaceId?: string;
}

export interface SwarmRecord {
  id: string;
  name: string;
  /** Default workspace for all steps (unless overridden per-step). */
  workspaceId?: string;
  steps: SwarmStep[];
  createdAt: number;
  updatedAt: number;
}

export interface SwarmMeta {
  id: string;
  name: string;
  stepCount: number;
  createdAt: number;
  updatedAt: number;
}

export type SwarmRunStatus = 'done' | 'rejected' | 'error' | 'interrupted';
