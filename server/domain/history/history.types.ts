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
}

export type SessionsFile = Record<string, SessionRecord>;
