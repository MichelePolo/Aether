import type { McpToolPolicy, LiveTool, McpTool } from '@/src/types/mcp.types';

async function jsonRes<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const mcpApi = {
  connect: (id: string): Promise<{ state: string; tools: McpTool[] }> =>
    fetch(`/api/mcp/${id}/connect`, { method: 'POST' }).then(jsonRes<{ state: string; tools: McpTool[] }>),

  disconnect: async (id: string): Promise<void> => {
    const res = await fetch(`/api/mcp/${id}/disconnect`, { method: 'POST' });
    if (!res.ok) throw new Error(res.statusText);
  },

  listTools: (): Promise<LiveTool[]> =>
    fetch('/api/mcp/tools')
      .then(jsonRes<{ tools: LiveTool[] }>)
      .then((b) => b.tools),

  togglePolicy: (id: string, name: string, policy: McpToolPolicy): Promise<McpToolPolicy> =>
    fetch(`/api/mcp/${id}/tools/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(policy),
    }).then(jsonRes<McpToolPolicy>),

  decide: async (callId: string, action: 'approve' | 'reject'): Promise<void> => {
    const res = await fetch('/api/mcp/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId, action }),
    });
    if (!res.ok) throw new Error(res.statusText);
  },

  state: (): Promise<Array<{ id: string; state: string; error?: string }>> =>
    fetch('/api/mcp/state')
      .then(jsonRes<{ servers: Array<{ id: string; state: string; error?: string }> }>)
      .then((b) => b.servers),

  refreshTools: (id: string): Promise<LiveTool[]> =>
    fetch(`/api/mcp/${id}/refresh-tools`, { method: 'POST' })
      .then(jsonRes<{ tools: LiveTool[] }>)
      .then((b) => b.tools),

  cancelCall: async (callId: string): Promise<void> => {
    const res = await fetch('/api/mcp/cancel-call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId }),
    });
    if (!res.ok) throw new Error(res.statusText);
  },
};
