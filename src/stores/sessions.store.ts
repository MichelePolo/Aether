import { create } from 'zustand';
import { sessionsApi } from '@/src/lib/api/sessions.api';
import { historyApi } from '@/src/lib/api/history.api';
import { workspacesApi } from '@/src/lib/api/workspaces.api';
import { useChatStore } from '@/src/stores/chat.store';
import type { SessionMeta } from '@/src/types/session.types';

const STORAGE_KEY = 'aether.activeSessionId';

interface SessionsState {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  hydrated: boolean;
  error: string | null;

  init: () => Promise<void>;
  create: () => Promise<SessionMeta>;
  rename: (id: string, title: string) => Promise<void>;
  setProviderName: (id: string, providerName: string) => Promise<void>;
  setSessionWorkspace: (sessionId: string, workspaceId: string | null) => Promise<void>;
  delete: (id: string) => Promise<void>;
  importSession: (file: File) => Promise<void>;
  forkSession: (fromMessageId: string) => Promise<void>;
  setActive: (id: string) => void;
  setLocalTitle: (id: string, title: string) => void;
  touchUpdatedAt: (id: string, ts: number) => void;
  clearError: () => void;
  _reset: () => void;
}

const initial = {
  sessions: [] as SessionMeta[],
  activeSessionId: null as string | null,
  hydrated: false,
  error: null as string | null,
};

let hydrationToken = 0;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

function persistActive(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore localStorage failures
  }
}

function readStoredActive(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function sortByUpdatedDesc(sessions: SessionMeta[]): SessionMeta[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  ...initial,
  _reset: () => set(initial),
  clearError: () => set({ error: null }),

  init: async () => {
    try {
      const list = await sessionsApi.list();
      const sessions = sortByUpdatedDesc(list);
      const stored = readStoredActive();
      let activeId: string | null;
      if (stored && sessions.some((s) => s.id === stored)) {
        activeId = stored;
      } else if (sessions.length > 0) {
        activeId = sessions[0].id;
      } else {
        const created = await sessionsApi.create();
        sessions.unshift(created);
        activeId = created.id;
      }
      persistActive(activeId);
      set({ sessions, activeSessionId: activeId, hydrated: true, error: null });
      // Hydrate chat for the chosen active session.
      const token = ++hydrationToken;
      historyApi
        .fetchById(activeId)
        .then((msgs) => {
          if (token !== hydrationToken) return;
          const chat = useChatStore.getState();
          // Don't clobber: user may have typed during the hydrate window
          if (chat.messages.length > 0 && msgs.length === 0) return;
          chat.hydrate(msgs);
        })
        .catch(() => {
          if (token !== hydrationToken) return;
          const chat = useChatStore.getState();
          if (chat.messages.length > 0) return;
          chat.hydrate([]);
        });
    } catch (e) {
      set({ sessions: [], activeSessionId: null, hydrated: true, error: errMsg(e) });
    }
  },

  create: async () => {
    try {
      const active = get().sessions.find((s) => s.id === get().activeSessionId);
      const meta = await sessionsApi.create(
        active?.workspaceId ? { workspaceId: active.workspaceId } : undefined,
      );
      set((s) => ({ sessions: [meta, ...s.sessions], error: null }));
      get().setActive(meta.id);
      return meta;
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  importSession: async (file) => {
    let envelope: unknown;
    try {
      const text = await file.text();
      envelope = JSON.parse(text);
    } catch {
      set({ error: 'Import failed: invalid JSON file' });
      return;
    }
    try {
      const meta = await sessionsApi.importSession(envelope);
      set((s) => ({ sessions: [meta, ...s.sessions], error: null }));
      get().setActive(meta.id);
    } catch (e) {
      set({ error: `Import failed: ${errMsg(e)}` });
    }
  },

  forkSession: async (fromMessageId) => {
    const activeId = get().activeSessionId;
    if (!activeId) return;
    try {
      const meta = await sessionsApi.forkSession(activeId, fromMessageId);
      set((s) => ({ sessions: [meta, ...s.sessions], error: null }));
      get().setActive(meta.id);
    } catch (e) {
      set({ error: `Fork failed: ${errMsg(e)}` });
    }
  },

  rename: async (id, title) => {
    const prev = get().sessions;
    const optimistic = prev.map((s) => (s.id === id ? { ...s, title } : s));
    set({ sessions: optimistic, error: null });
    try {
      await sessionsApi.rename(id, title);
    } catch (e) {
      set({ sessions: prev, error: errMsg(e) });
      throw e;
    }
  },

  setSessionWorkspace: async (sessionId, workspaceId) => {
    // PATCH the server, then update locally, then trigger MCP reroot.
    await sessionsApi.updateSession(sessionId, { workspaceId });
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === sessionId ? { ...x, workspaceId: workspaceId ?? undefined } : x,
      ),
    }));
    workspacesApi.activateForSession(sessionId).catch(() => {});
  },

  setProviderName: async (id, providerName) => {
    const prev = get().sessions;
    const optimistic = prev.map((s) =>
      s.id === id ? { ...s, providerName } : s,
    );
    set({ sessions: optimistic, error: null });
    try {
      await sessionsApi.setProviderName(id, providerName);
    } catch (e) {
      set({ sessions: prev, error: errMsg(e) });
      throw e;
    }
  },

  delete: async (id) => {
    try {
      await sessionsApi.delete(id);
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
    const wasActive = get().activeSessionId === id;
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id), error: null }));
    if (wasActive) {
      const remaining = get().sessions;
      if (remaining.length > 0) {
        get().setActive(remaining[0].id);
      } else {
        await get().create();
      }
    }
  },

  setActive: (id) => {
    if (useChatStore.getState().streamingId !== null) return;
    if (get().activeSessionId === id) return;
    const run = () => {
      persistActive(id);
      set({ activeSessionId: id, error: null });
      useChatStore.getState().reset();
    };
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as Document & { startViewTransition: (cb: () => void) => unknown }).startViewTransition(run);
    } else {
      run();
    }
    // Slice 23: reroot Filesystem MCP for this session's workspace (fire-and-forget).
    workspacesApi.activateForSession(id).catch(() => {});
    const token = ++hydrationToken;
    historyApi
      .fetchById(id)
      .then((msgs) => {
        if (token !== hydrationToken) return;
        const chat = useChatStore.getState();
        // Don't clobber: user may have typed during the hydrate window
        if (chat.messages.length > 0 && msgs.length === 0) return;
        chat.hydrate(msgs);
      })
      .catch(() => {
        if (token !== hydrationToken) return;
        const chat = useChatStore.getState();
        if (chat.messages.length > 0) return;
        chat.hydrate([]);
      });
  },

  setLocalTitle: (id, title) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)),
    })),

  touchUpdatedAt: (id, ts) =>
    set((s) => ({
      sessions: sortByUpdatedDesc(
        s.sessions.map((x) => (x.id === id ? { ...x, updatedAt: ts } : x)),
      ),
    })),
}));
