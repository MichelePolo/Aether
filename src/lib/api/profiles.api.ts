import type { AetherContext } from '@/src/types/context.types';
import type { ProfileMeta, ProfileRecord } from '@/src/types/profile.types';

const BASE = '/api/profiles';

interface ErrorBody { error?: { message?: string } }

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

export interface CreateProfileInput {
  name: string;
  context: AetherContext;
  thinkingEnabled: boolean;
}

export const profilesApi = {
  list: async (): Promise<ProfileMeta[]> => {
    const res = await fetch(BASE);
    const body = await asJson<{ profiles: ProfileMeta[] }>(res);
    return body.profiles;
  },
  get: async (id: string): Promise<ProfileRecord> => {
    const res = await fetch(`${BASE}/${id}`);
    return asJson<ProfileRecord>(res);
  },
  create: async (input: CreateProfileInput): Promise<ProfileMeta> => {
    const res = await fetch(BASE, json('POST', input));
    return asJson<ProfileMeta>(res);
  },
  update: async (id: string, body: ProfileRecord): Promise<ProfileMeta> => {
    const res = await fetch(`${BASE}/${id}`, json('PUT', body));
    return asJson<ProfileMeta>(res);
  },
  rename: async (id: string, name: string): Promise<ProfileMeta> => {
    const res = await fetch(`${BASE}/${id}`, json('PATCH', { name }));
    return asJson<ProfileMeta>(res);
  },
  delete: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
    await asJson<void>(res);
  },
  importJson: async (parsed: unknown): Promise<ProfileMeta> => {
    const res = await fetch(`${BASE}/import`, json('POST', parsed));
    return asJson<ProfileMeta>(res);
  },
};
