import type { OllamaEndpointStatus } from './ollama-endpoints.types';
import type { OpenAICompatEndpointStatus } from './openai-endpoints.types';

export type ProviderTransport = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'openai-compat';
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
  openaiCompat: OpenAICompatEndpointStatus[];
  checkedAt: number;
}

export const TRANSPORT_ORDER: ProviderTransport[] = [
  'anthropic', 'openai', 'gemini', 'ollama', 'openai-compat',
];
