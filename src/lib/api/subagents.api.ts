import type { SubAgentMeta, SubAgentRecord } from '@/src/types/subagent.types';
import type { Tool } from '@/src/types/context.types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export interface SubAgentCreateInput {
  name: string;
  systemInstruction?: string;
  skills?: string[];
  tools?: Tool[];
  model?: string;
}

export type SubAgentUpdateInput = Partial<SubAgentCreateInput>;

export const subagentsApi = {
  list: async (): Promise<SubAgentMeta[]> => {
    const res = await fetch('/api/subagents');
    const body = await json<{ subAgents: SubAgentMeta[] }>(res);
    return body.subAgents;
  },
  get: async (id: string): Promise<SubAgentRecord & { id: string }> => {
    return json<SubAgentRecord & { id: string }>(await fetch(`/api/subagents/${id}`));
  },
  create: async (input: SubAgentCreateInput): Promise<SubAgentMeta> => {
    const res = await fetch('/api/subagents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return json<SubAgentMeta>(res);
  },
  update: async (id: string, input: SubAgentUpdateInput): Promise<SubAgentMeta> => {
    const res = await fetch(`/api/subagents/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return json<SubAgentMeta>(res);
  },
  delete: async (id: string): Promise<void> => {
    const res = await fetch(`/api/subagents/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.statusText);
  },
};
