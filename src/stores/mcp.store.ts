import { create } from 'zustand';
import { mcpApi } from '@/src/lib/api/mcp.api';
import type { LiveTool, McpConnectionState } from '@/src/types/mcp.types';

export interface InFlightCall {
  callId: string;
  qualifiedName: string;
  args: Record<string, unknown>;
  progressNote?: string;
}

interface McpState {
  liveTools: LiveTool[];
  connectStates: Record<string, McpConnectionState>;
  errors: Record<string, string>;
  inFlightCalls: Record<string, InFlightCall>;
  reconnectInfo: Record<string, { attempt: number; max: number }>;

  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  togglePolicy: (serverId: string, name: string, autoApprove: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  refreshServer: (id: string) => Promise<void>;
  applyServerStateEvent: (
    id: string,
    state: McpConnectionState,
    error?: string,
    reconnectAttempt?: number,
    reconnectMaxAttempts?: number,
  ) => void;
  clearError: (id: string) => void;
  registerInFlightCall: (call: InFlightCall) => void;
  updateInFlightProgress: (callId: string, note: string) => void;
  clearInFlightCall: (callId: string) => void;
  _reset: () => void;
}

const initial = {
  liveTools: [] as LiveTool[],
  connectStates: {} as Record<string, McpConnectionState>,
  errors: {} as Record<string, string>,
  inFlightCalls: {} as Record<string, InFlightCall>,
  reconnectInfo: {} as Record<string, { attempt: number; max: number }>,
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

  refreshServer: async (id) => {
    try {
      const tools = await mcpApi.refreshTools(id);
      set((s) => ({
        liveTools: [...s.liveTools.filter((t) => t.serverId !== id), ...tools],
      }));
    } catch (e) {
      set((s) => ({ errors: { ...s.errors, [id]: errMsg(e) } }));
      throw e;
    }
  },

  applyServerStateEvent: (id, state, error, reconnectAttempt, reconnectMaxAttempts) =>
    set((s) => {
      let reconnectInfo = s.reconnectInfo;
      if (state === 'reconnecting' && reconnectAttempt !== undefined && reconnectMaxAttempts !== undefined) {
        reconnectInfo = { ...s.reconnectInfo, [id]: { attempt: reconnectAttempt, max: reconnectMaxAttempts } };
      } else if (state === 'online' || state === 'offline') {
        if (s.reconnectInfo[id]) {
          const next = { ...s.reconnectInfo };
          delete next[id];
          reconnectInfo = next;
        }
      }
      return {
        connectStates: { ...s.connectStates, [id]: state },
        errors: error ? { ...s.errors, [id]: error } : s.errors,
        reconnectInfo,
      };
    }),

  clearError: (id) =>
    set((s) => {
      const next = { ...s.errors };
      delete next[id];
      return { errors: next };
    }),

  registerInFlightCall: (call) =>
    set((s) => ({ inFlightCalls: { ...s.inFlightCalls, [call.callId]: call } })),

  updateInFlightProgress: (callId, note) =>
    set((s) => {
      const cur = s.inFlightCalls[callId];
      if (!cur) return s;
      return {
        inFlightCalls: { ...s.inFlightCalls, [callId]: { ...cur, progressNote: note } },
      };
    }),

  clearInFlightCall: (callId) =>
    set((s) => {
      const next = { ...s.inFlightCalls };
      delete next[callId];
      return { inFlightCalls: next };
    }),
}));
