/** Public shape returned over HTTP — token is never sent in plaintext. */
export interface OllamaEndpointRecord {
  id: string;
  label: string;
  baseUrl: string;
  hasToken: boolean;
  tokenMasked: string | null;
  fixed: boolean;            // true only for the synthetic local endpoint
  createdAt: number | null;
  updatedAt: number | null;
}

/** Internal shape with decrypted token, for the registry / probing only. */
export interface ResolvedOllamaEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  token?: string;
}

export interface CreateOllamaEndpointInput {
  label: string;
  baseUrl: string;
  token?: string;
}

export interface UpdateOllamaEndpointInput {
  label?: string;
  baseUrl?: string;
  token?: string | null;     // null or '' clears the token; undefined leaves it
}
