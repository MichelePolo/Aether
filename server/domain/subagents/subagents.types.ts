import type { Tool } from '@/server/domain/context/context.types';

export interface SubAgentRecord {
  name: string;
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  /** Optional default provider (transport:model). Undefined = no default. */
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SubAgentMeta {
  id: string;
  name: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export type SubAgentsFile = Record<string, SubAgentRecord>;
