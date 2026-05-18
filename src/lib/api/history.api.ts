import type { Message } from '@/src/types/message.types';

const BASE = '/api/sessions';

interface ErrorBody { error?: { message?: string } }

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const historyApi = {
  fetchDefault: async (): Promise<Message[]> => {
    const res = await fetch(`${BASE}/default`);
    const body = await asJson<{ messages: Message[] }>(res);
    return body.messages;
  },
  clearDefault: async (): Promise<void> => {
    const res = await fetch(`${BASE}/default`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },
};
