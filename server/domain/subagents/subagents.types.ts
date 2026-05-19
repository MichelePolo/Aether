import type { Tool } from '@/server/domain/context/context.types';

export interface SubAgentRecord {
  name: string;
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  createdAt: number;
  updatedAt: number;
}

export interface SubAgentMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type SubAgentsFile = Record<string, SubAgentRecord>;
