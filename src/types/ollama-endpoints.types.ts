export interface OllamaEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  hasToken: boolean;
  tokenMasked: string | null;
  fixed: boolean;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface OllamaEndpointStatus {
  id: string;
  label: string;
  fixed: boolean;
  state: 'ok' | 'unconfigured' | 'error';
  reason?: string;
  detail?: string;
}

export interface SaveOllamaEndpointResponse {
  endpoint: OllamaEndpoint;
  status: OllamaEndpointStatus | null;
}
