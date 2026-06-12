import { create } from 'zustand';
import { contextApi } from '@/src/lib/api/context.api';
import type { AetherContext, Tool, McpServerConfig } from '@/src/types/context.types';

interface ContextState {
  context: AetherContext | null;
  isLoading: boolean;
  error: string | null;

  init: () => Promise<void>;
  setSystemInstruction: (v: string) => Promise<void>;
  addSkill: (name: string) => Promise<void>;
  updateSkillAt: (i: number, v: string) => Promise<void>;
  toggleSkillAt: (i: number) => Promise<void>;
  removeSkillAt: (i: number) => Promise<void>;
  addTool: (input: Omit<Tool, 'id'>) => Promise<void>;
  updateTool: (id: string, patch: Partial<Omit<Tool, 'id'>>) => Promise<void>;
  removeTool: (id: string) => Promise<void>;
  addMcpServer: (input: Omit<McpServerConfig, 'id'>) => Promise<void>;
  removeMcpServer: (id: string) => Promise<void>;
  getCurrentContext: () => AetherContext | null;
  bulkOverwrite: (ctx: AetherContext) => Promise<void>;
  _reset: () => void;
}

const initial = { context: null, isLoading: false, error: null };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

export const useContextStore = create<ContextState>((set, get) => ({
  ...initial,

  _reset: () => set(initial),

  init: async () => {
    set({ isLoading: true, error: null });
    try {
      const context = await contextApi.get();
      set({ context, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: errMsg(e) });
    }
  },

  setSystemInstruction: async (v) => {
    const prev = get().context;
    if (!prev) return;
    set({ context: { ...prev, systemInstruction: v } });
    try {
      const fresh = await contextApi.patch({ systemInstruction: v });
      set({ context: fresh });
    } catch (e) {
      set({ context: prev, error: errMsg(e) });
      throw e;
    }
  },

  addSkill: async (name) => {
    const prev = get().context;
    if (!prev) return;
    set({ context: { ...prev, skills: [...prev.skills, { name, enabled: true }] } });
    try {
      await contextApi.addSkill(name);
    } catch (e) {
      set({ context: prev, error: errMsg(e) });
      throw e;
    }
  },

  updateSkillAt: async (i, v) => {
    const prev = get().context;
    if (!prev) return;
    const next = [...prev.skills];
    next[i] = { ...next[i], name: v };
    set({ context: { ...prev, skills: next } });
    try {
      await contextApi.updateSkillAt(i, v);
    } catch (e) {
      set({ context: prev, error: errMsg(e) });
      throw e;
    }
  },

  toggleSkillAt: async (i) => {
    const prev = get().context;
    if (!prev) return;
    const current = prev.skills[i];
    if (!current) return;
    const nextEnabled = !current.enabled;
    const next = [...prev.skills];
    next[i] = { ...current, enabled: nextEnabled };
    set({ context: { ...prev, skills: next } });
    try {
      await contextApi.setSkillEnabledAt(i, nextEnabled);
    } catch (e) {
      set({ context: prev, error: errMsg(e) });
      throw e;
    }
  },

  removeSkillAt: async (i) => {
    const prev = get().context;
    if (!prev) return;
    set({ context: { ...prev, skills: prev.skills.filter((_, idx) => idx !== i) } });
    try {
      await contextApi.removeSkillAt(i);
    } catch (e) {
      set({ context: prev, error: errMsg(e) });
      throw e;
    }
  },

  addTool: async (input) => {
    const prev = get().context;
    if (!prev) return;
    try {
      const tool = await contextApi.addTool(input);
      const cur = get().context;
      if (cur) set({ context: { ...cur, tools: [...cur.tools, tool] } });
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  updateTool: async (id, patch) => {
    const prev = get().context;
    if (!prev) return;
    const next = prev.tools.map((t) => (t.id === id ? { ...t, ...patch } : t));
    set({ context: { ...prev, tools: next } });
    try {
      await contextApi.updateTool(id, patch);
    } catch (e) {
      set({ context: prev, error: errMsg(e) });
      throw e;
    }
  },

  removeTool: async (id) => {
    const prev = get().context;
    if (!prev) return;
    set({ context: { ...prev, tools: prev.tools.filter((t) => t.id !== id) } });
    try {
      await contextApi.removeTool(id);
    } catch (e) {
      set({ context: prev, error: errMsg(e) });
      throw e;
    }
  },

  addMcpServer: async (input) => {
    const prev = get().context;
    if (!prev) return;
    try {
      const srv = await contextApi.addMcpServer(input);
      const cur = get().context;
      if (cur) set({ context: { ...cur, mcpServers: [...cur.mcpServers, srv] } });
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  removeMcpServer: async (id) => {
    const prev = get().context;
    if (!prev) return;
    set({ context: { ...prev, mcpServers: prev.mcpServers.filter((s) => s.id !== id) } });
    try {
      await contextApi.removeMcpServer(id);
    } catch (e) {
      set({ context: prev, error: errMsg(e) });
      throw e;
    }
  },

  getCurrentContext: () => get().context,

  bulkOverwrite: async (ctx) => {
    set({ error: null });
    try {
      const fresh = await contextApi.bulkOverwrite(ctx);
      set({ context: fresh });
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },
}));
