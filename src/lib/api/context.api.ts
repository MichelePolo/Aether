import type { AetherContext, Tool, McpServerConfig } from '@/src/types/context.types';

const BASE = '/api/context';

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function noContent(res: Response): Promise<void> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

export const contextApi = {
  get: () => fetch(BASE).then((r) => asJson<AetherContext>(r)),

  patch: (patch: Partial<AetherContext>) =>
    fetch(BASE, json('PATCH', patch)).then((r) => asJson<AetherContext>(r)),

  bulkOverwrite: (ctx: AetherContext) =>
    fetch(BASE, json('PUT', ctx)).then((r) => asJson<AetherContext>(r)),

  addSkill: (name: string) =>
    fetch(`${BASE}/skills`, json('POST', { name })).then(noContent),

  updateSkillAt: (index: number, value: string) =>
    fetch(`${BASE}/skills/${index}`, json('PATCH', { value })).then(noContent),

  removeSkillAt: (index: number) =>
    fetch(`${BASE}/skills/${index}`, { method: 'DELETE' }).then(noContent),

  addTool: (input: Omit<Tool, 'id'>) =>
    fetch(`${BASE}/tools`, json('POST', input)).then((r) => asJson<Tool>(r)),

  updateTool: (id: string, patch: Partial<Omit<Tool, 'id'>>) =>
    fetch(`${BASE}/tools/${id}`, json('PATCH', patch)).then(noContent),

  removeTool: (id: string) =>
    fetch(`${BASE}/tools/${id}`, { method: 'DELETE' }).then(noContent),

  addMcpServer: (input: Omit<McpServerConfig, 'id'>) =>
    fetch(`${BASE}/mcp-servers`, json('POST', input)).then((r) => asJson<McpServerConfig>(r)),

  removeMcpServer: (id: string) =>
    fetch(`${BASE}/mcp-servers/${id}`, { method: 'DELETE' }).then(noContent),
};
