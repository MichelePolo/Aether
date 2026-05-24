import type { SessionMeta } from '@/src/types/session.types';

const BASE = '/api/sessions';

interface ErrorBody {
  error?: { message?: string };
}

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

export const sessionsApi = {
  list: async (): Promise<SessionMeta[]> => {
    const res = await fetch(BASE);
    const body = await asJson<{ sessions: SessionMeta[] }>(res);
    return body.sessions;
  },
  create: async (): Promise<SessionMeta> => {
    const res = await fetch(BASE, json('POST'));
    return asJson<SessionMeta>(res);
  },
  rename: async (id: string, title: string): Promise<SessionMeta> => {
    const res = await fetch(`${BASE}/${id}`, json('PATCH', { title }));
    return asJson<SessionMeta>(res);
  },
  delete: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
    await asJson<void>(res);
  },
  setProviderName: async (id: string, providerName: string): Promise<void> => {
    const res = await fetch(`${BASE}/${id}`, json('PATCH', { providerName }));
    await asJson<void>(res);
  },
  exportSessionUrl: (id: string): string => `${BASE}/${id}/export`,
  importSession: async (envelope: unknown): Promise<SessionMeta> => {
    const res = await fetch(`${BASE}/import`, json('POST', envelope));
    return asJson<SessionMeta>(res);
  },
  forkSession: async (id: string, fromMessageId: string): Promise<SessionMeta> => {
    const res = await fetch(`${BASE}/${id}/fork`, json('POST', { fromMessageId }));
    const body = await asJson<{ meta: SessionMeta }>(res);
    return body.meta;
  },
  updateSession: async (
    id: string,
    patch: { title?: string; workspaceId?: string | null },
  ): Promise<{ id: string; title: string; createdAt: number; updatedAt: number }> => {
    const res = await fetch(`${BASE}/${id}`, json('PATCH', patch));
    return asJson<{ id: string; title: string; createdAt: number; updatedAt: number }>(res);
  },
};

export async function updateSession(
  id: string,
  patch: { title?: string; workspaceId?: string | null },
): Promise<{ id: string; title: string; createdAt: number; updatedAt: number }> {
  const res = await fetch(`${BASE}/${id}`, json('PATCH', patch));
  return asJson<{ id: string; title: string; createdAt: number; updatedAt: number }>(res);
}
