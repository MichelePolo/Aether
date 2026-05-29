export interface SwarmStep {
  subAgentName: string;
  promptTemplate: string;
  pauseAfter: boolean;
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
