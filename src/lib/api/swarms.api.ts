export interface SwarmStep {
  subAgentName: string;
  promptTemplate: string;
  pauseAfter: boolean;
}
export interface SwarmMeta {
  id: string;
  name: string;
  stepCount: number;
  createdAt: number;
  updatedAt: number;
}
export interface SwarmRecord extends SwarmMeta {
  steps: SwarmStep[];
}
export interface SwarmInput {
  name: string;
  steps: SwarmStep[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const swarmsApi = {
  list: async (): Promise<SwarmMeta[]> =>
    (await json<{ swarms: SwarmMeta[] }>(await fetch('/api/swarms'))).swarms,
  get: async (id: string): Promise<SwarmRecord> => json(await fetch(`/api/swarms/${id}`)),
  create: async (input: SwarmInput): Promise<SwarmMeta> =>
    json(
      await fetch('/api/swarms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    ),
  update: async (id: string, input: Partial<SwarmInput>): Promise<SwarmMeta> =>
    json(
      await fetch(`/api/swarms/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    ),
  delete: async (id: string): Promise<void> => {
    const res = await fetch(`/api/swarms/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },
  decision: async (approvalId: string, action: 'approve' | 'reject'): Promise<void> => {
    await fetch('/api/swarms/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId, action }),
    });
  },
};
