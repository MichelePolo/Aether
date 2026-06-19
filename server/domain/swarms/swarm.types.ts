export interface SwarmStep {
  subAgentName: string;
  promptTemplate: string;
  pauseAfter: boolean;
  /** Optional provider override (transport:model). Undefined = inherit. */
  providerName?: string;
}

export interface SwarmRecord {
  id: string;
  name: string;
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
