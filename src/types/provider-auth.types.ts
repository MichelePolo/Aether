import type { OllamaEndpointStatus } from './ollama-endpoints.types';

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
  ollama: OllamaEndpointStatus[];
  checkedAt: number;
}

export const TRANSPORT_ORDER: ProviderTransport[] = [
  'anthropic', 'openai', 'gemini', 'ollama',
];
