/** Public shape returned over HTTP — token is never sent in plaintext. */
export interface OllamaEndpointRecord {
  id: string;
  label: string;
  baseUrl: string;
  hasToken: boolean;
  tokenMasked: string | null;
  fixed: boolean;            // true only for the synthetic local endpoint
  /** Only the header keys are exposed; values remain encrypted. */
  headerKeys: string[];
  createdAt: number | null;
  updatedAt: number | null;
}

/** Internal shape with decrypted token and headers, for the registry / probing only. */
export interface ResolvedOllamaEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  token?: string;
  headers: Record<string, string>;
}

export interface CreateOllamaEndpointInput {
  label: string;
  baseUrl: string;
  token?: string;
  headers?: Record<string, string>;
}

export interface UpdateOllamaEndpointInput {
  label?: string;
  baseUrl?: string;
  token?: string | null;     // null or '' clears the token; undefined leaves it
  headers?: Record<string, string>;
}
