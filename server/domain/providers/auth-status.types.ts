export type ProviderTransport = 'anthropic' | 'openai' | 'gemini' | 'ollama';
export type AuthState = 'ok' | 'unconfigured' | 'error';

export interface TransportStatus {
  transport: ProviderTransport;
  state: AuthState;
  reason: string;
  detail?: string;
}

export interface OllamaEndpointStatus {
  id: string;
  label: string;
  fixed: boolean;
  state: AuthState;
  reason?: string;
  detail?: string;
}

export interface AuthStatusReport {
  statuses: TransportStatus[]; // anthropic, openai, gemini (keyed, fixed order)
  ollama: OllamaEndpointStatus[];
  checkedAt: number;
}

export const TRANSPORT_ORDER: ProviderTransport[] = [
  'anthropic',
  'openai',
  'gemini',
  'ollama',
];
