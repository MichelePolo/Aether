import type { ProviderDescriptor } from '@/src/types/provider.types';
import type { AuthStatusReport, ProviderTransport } from '@/src/types/provider-auth.types';
import type {
  KeyVaultListResponse,
  SaveKeyResponse,
  VaultTransport,
} from '@/src/types/key-vault.types';
import type {
  OllamaEndpoint,
  SaveOllamaEndpointResponse,
} from '@/src/types/ollama-endpoints.types';

async function jsonRes<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const providersApi = {
  list: (): Promise<ProviderDescriptor[]> =>
    fetch('/api/providers')
      .then(jsonRes<{ providers: ProviderDescriptor[] }>)
      .then((b) => b.providers),

  refresh: (): Promise<ProviderDescriptor[]> =>
    fetch('/api/providers/refresh', { method: 'POST' })
      .then(jsonRes<{ providers: ProviderDescriptor[] }>)
      .then((b) => b.providers),

  defaultName: (): Promise<string | null> =>
    fetch('/api/providers/default')
      .then(jsonRes<{ name: string | null }>)
      .then((b) => b.name),

  fetchAuthStatus: (): Promise<AuthStatusReport> =>
    fetch('/api/providers/auth-status').then(jsonRes<AuthStatusReport>),

  refreshAuthStatus: (transport?: ProviderTransport): Promise<AuthStatusReport> => {
    const url = transport
      ? `/api/providers/auth-status/refresh?transport=${encodeURIComponent(transport)}`
      : '/api/providers/auth-status/refresh';
    return fetch(url, { method: 'POST' }).then(jsonRes<AuthStatusReport>);
  },

  listKeys: (): Promise<KeyVaultListResponse> =>
    fetch('/api/providers/keys').then(jsonRes<KeyVaultListResponse>),

  setKey: (transport: VaultTransport, key: string): Promise<SaveKeyResponse> =>
    fetch(`/api/providers/keys/${transport}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }).then(jsonRes<SaveKeyResponse>),

  clearKey: (transport: VaultTransport): Promise<{ status: SaveKeyResponse['status'] }> =>
    fetch(`/api/providers/keys/${transport}`, { method: 'DELETE' })
      .then(jsonRes<{ status: SaveKeyResponse['status'] }>),

  revealKey: (transport: VaultTransport): Promise<string> =>
    fetch(`/api/providers/keys/${transport}?reveal=1`)
      .then(jsonRes<{ plaintext: string }>)
      .then((b) => b.plaintext),

  listOllamaEndpoints: (): Promise<OllamaEndpoint[]> =>
    fetch('/api/providers/ollama-endpoints')
      .then(jsonRes<{ endpoints: OllamaEndpoint[] }>)
      .then((b) => b.endpoints),

  createOllamaEndpoint: (input: { label: string; baseUrl: string; token?: string }): Promise<SaveOllamaEndpointResponse> =>
    fetch('/api/providers/ollama-endpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(jsonRes<SaveOllamaEndpointResponse>),

  updateOllamaEndpoint: (
    id: string,
    patch: { label?: string; baseUrl?: string; token?: string | null },
  ): Promise<SaveOllamaEndpointResponse> =>
    fetch(`/api/providers/ollama-endpoints/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(jsonRes<SaveOllamaEndpointResponse>),

  deleteOllamaEndpoint: (id: string): Promise<{ ok: boolean }> =>
    fetch(`/api/providers/ollama-endpoints/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(jsonRes<{ ok: boolean }>),
};
