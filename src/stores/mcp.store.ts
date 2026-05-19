import { create } from 'zustand';
import { mcpApi } from '@/src/lib/api/mcp.api';
import type { LiveTool, McpConnectionState } from '@/src/types/mcp.types';

interface McpState {
  liveTools: LiveTool[];
  connectStates: Record<string, McpConnectionState>;
  errors: Record<string, string>;

  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  togglePolicy: (serverId: string, name: string, autoApprove: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  applyServerStateEvent: (id: string, state: McpConnectionState, error?: string) => void;
  clearError: (id: string) => void;
  _reset: () => void;
}

const initial = {
  liveTools: [] as LiveTool[],
  connectStates: {} as Record<string, McpConnectionState>,
  errors: {} as Record<string, string>,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

export const useMcpStore = create<McpState>((set) => ({
  ...initial,
  _reset: () => set(initial),

  connect: async (id) => {
    set((s) => ({ connectStates: { ...s.connectStates, [id]: 'connecting' } }));
    try {
      await mcpApi.connect(id);
      const tools = await mcpApi.listTools();
      set((s) => ({
        liveTools: tools,
        connectStates: { ...s.connectStates, [id]: 'online' },
        errors: { ...s.errors, [id]: '' },
      }));
    } catch (e) {
      const msg = errMsg(e);
      set((s) => ({
        connectStates: { ...s.connectStates, [id]: 'error' },
        errors: { ...s.errors, [id]: msg },
      }));
      throw e;
    }
  },

  disconnect: async (id) => {
    try {
      await mcpApi.disconnect(id);
      const tools = await mcpApi.listTools();
      set((s) => ({
        liveTools: tools,
        connectStates: { ...s.connectStates, [id]: 'offline' },
      }));
    } catch (e) {
      set((s) => ({ errors: { ...s.errors, [id]: errMsg(e) } }));
      throw e;
    }
  },

  togglePolicy: async (serverId, name, autoApprove) => {
    await mcpApi.togglePolicy(serverId, name, { autoApprove });
    set((s) => ({
      liveTools: s.liveTools.map((t) =>
        t.serverId === serverId && t.tool.name === name ? { ...t, autoApprove } : t,
      ),
    }));
  },

  refresh: async () => {
    const tools = await mcpApi.listTools();
    set({ liveTools: tools });
  },

  applyServerStateEvent: (id, state, error) =>
    set((s) => ({
      connectStates: { ...s.connectStates, [id]: state },
      errors: error ? { ...s.errors, [id]: error } : s.errors,
    })),

  clearError: (id) =>
    set((s) => {
      const next = { ...s.errors };
      delete next[id];
      return { errors: next };
    }),
}));
