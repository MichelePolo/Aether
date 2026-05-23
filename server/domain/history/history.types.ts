import type { ReasoningStep } from '@/server/domain/reasoning/reasoning.types';

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  model?: string;
  interrupted?: boolean;
  error?: string;
  retryable?: boolean;
  reasoningSteps?: ReasoningStep[];
  tokensIn?: number;
  tokensOut?: number;
}

export interface SessionRecord {
  title: string;
  createdAt: number;
  providerName?: string;
  messages: Message[];
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  providerName?: string;
}

export type SessionsFile = Record<string, SessionRecord>;

export type { ExportEnvelope } from './history.export';
