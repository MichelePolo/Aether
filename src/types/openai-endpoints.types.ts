export interface OpenAICompatEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  model: string | null;
  headerKeys: string[];
  createdAt: number | null;
  updatedAt: number | null;
}

export interface OpenAICompatEndpointStatus {
  id: string;
  label: string;
  state: 'ok' | 'unconfigured' | 'error';
  reason?: string;
  detail?: string;
}

export interface SaveOpenAICompatEndpointResponse {
  endpoint: OpenAICompatEndpoint;
  status: OpenAICompatEndpointStatus | null;
}
