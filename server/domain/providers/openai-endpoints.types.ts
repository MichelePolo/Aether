/** Public shape returned over HTTP — header values are never sent in plaintext. */
export interface OpenAICompatEndpointRecord {
  id: string;
  label: string;
  baseUrl: string;
  model: string | null;
  /** Only the header keys are exposed; values remain encrypted. */
  headerKeys: string[];
  createdAt: number;
  updatedAt: number;
}

/** Internal shape with decrypted headers, for the registry / probing only. */
export interface ResolvedOpenAICompatEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  model: string | null;
  headers: Record<string, string>;
}

export interface CreateOpenAICompatEndpointInput {
  label: string;
  baseUrl: string;
  model?: string | null;
  headers?: Record<string, string>;
}

export type UpdateOpenAICompatEndpointInput = Partial<CreateOpenAICompatEndpointInput>;
