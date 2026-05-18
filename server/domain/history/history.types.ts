export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  model?: string;
  interrupted?: boolean;
  error?: string;
  retryable?: boolean;
}

export type SessionsFile = Record<string, Message[]>;
