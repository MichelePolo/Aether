export type Cadence = { kind: 'cron'; expr: string } | { kind: 'interval'; everyMs: number };
export type Target =
  | { kind: 'prompt'; prompt: string; subAgent?: string }
  | { kind: 'swarm'; swarmId: string; input?: string };
export interface Schedule {
  id: string; name: string; cadence: Cadence; target: Target;
  autonomy: 'safe' | 'trusted'; providerName?: string; workspaceId?: string;
  enabled: boolean; nextRunAt: number | null; lastRunAt?: number; createdAt: number; updatedAt: number;
}
export interface ScheduleRun {
  id: string; scheduleId: string; sessionId: string | null;
  startedAt: number; finishedAt?: number; status: 'running' | 'success' | 'error' | 'rejected'; error?: string;
}
export interface ScheduleInput {
  name: string; cadence: Cadence; target: Target;
  autonomy?: 'safe' | 'trusted'; providerName?: string; workspaceId?: string; enabled?: boolean;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}
function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}

export const schedulesApi = {
  list: async (): Promise<Schedule[]> =>
    (await jsonOrThrow<{ schedules: Schedule[] }>(await fetch('/api/schedules'))).schedules,
  create: async (input: ScheduleInput): Promise<Schedule> => jsonOrThrow<Schedule>(await post('/api/schedules', input)),
  update: async (id: string, input: Partial<ScheduleInput>): Promise<Schedule> =>
    jsonOrThrow<Schedule>(await fetch(`/api/schedules/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })),
  remove: async (id: string): Promise<void> => { const r = await fetch(`/api/schedules/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(`Request failed: ${r.status}`); },
  runNow: async (id: string): Promise<void> => { const r = await post(`/api/schedules/${id}/run`); if (!r.ok) throw new Error(`Request failed: ${r.status}`); },
  runs: async (id: string): Promise<ScheduleRun[]> =>
    (await jsonOrThrow<{ runs: ScheduleRun[] }>(await fetch(`/api/schedules/${id}/runs`))).runs,
};
