export type ProviderTransport = 'anthropic' | 'openai' | 'gemini' | 'ollama';
export type AuthState = 'ok' | 'unconfigured' | 'error';

export interface TransportStatus {
  transport: ProviderTransport;
  state: AuthState;
  reason: string;
  detail?: string;
}

export interface AuthStatusReport {
  statuses: TransportStatus[];
  checkedAt: number;
}

export const TRANSPORT_ORDER: ProviderTransport[] = [
  'anthropic', 'openai', 'gemini', 'ollama',
];
