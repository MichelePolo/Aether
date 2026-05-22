import type { ProviderDescriptor } from '@/src/types/provider.types';
import type { AuthStatusReport, ProviderTransport } from '@/src/types/provider-auth.types';

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
};
