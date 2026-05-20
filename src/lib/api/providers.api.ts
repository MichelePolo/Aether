import type { ProviderDescriptor } from '@/src/types/provider.types';

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
};
