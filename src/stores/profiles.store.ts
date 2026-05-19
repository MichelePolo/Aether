import { create } from 'zustand';
import { profilesApi } from '@/src/lib/api/profiles.api';
import { useContextStore } from '@/src/stores/context.store';
import { useUiStore } from '@/src/stores/ui.store';
import type { ProfileMeta, ProfileRecord } from '@/src/types/profile.types';

const STORAGE_KEY = 'aether.activeProfileId';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILENAME_SANITIZE = /[^a-zA-Z0-9-_.]/g;

interface ProfilesState {
  profiles: ProfileMeta[];
  activeProfileId: string | null;
  hydrated: boolean;
  error: string | null;

  init: () => Promise<void>;
  saveCurrent: (name: string) => Promise<ProfileMeta>;
  saveCurrentToActive: () => Promise<void>;
  saveCurrentTo: (id: string) => Promise<void>;
  apply: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
  exportProfile: (id: string) => Promise<void>;
  importFile: (file: File) => Promise<ProfileMeta>;
  clearError: () => void;
  _reset: () => void;
}

const initial = {
  profiles: [] as ProfileMeta[],
  activeProfileId: null as string | null,
  hydrated: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

function readStoredActive(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistActive(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

function sortByUpdatedDesc(profiles: ProfileMeta[]): ProfileMeta[] {
  return [...profiles].sort((a, b) => b.updatedAt - a.updatedAt);
}

function sanitizeFilename(name: string): string {
  return name.replace(FILENAME_SANITIZE, '_');
}

// Direct download: creating a blob + anchor click. Inline here so the store
// doesn't need to import a React hook (Zustand stores are non-React).
function triggerDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const useProfilesStore = create<ProfilesState>((set, get) => ({
  ...initial,
  _reset: () => set(initial),
  clearError: () => set({ error: null }),

  init: async () => {
    try {
      const list = await profilesApi.list();
      const profiles = sortByUpdatedDesc(list);
      const stored = readStoredActive();
      let activeId: string | null = null;
      if (stored && profiles.some((p) => p.id === stored)) {
        activeId = stored;
      } else if (stored) {
        persistActive(null);
      }
      set({ profiles, activeProfileId: activeId, hydrated: true, error: null });
    } catch (e) {
      set({ profiles: [], activeProfileId: null, hydrated: true, error: errMsg(e) });
    }
  },

  saveCurrent: async (name) => {
    const ctx = useContextStore.getState().getCurrentContext();
    if (!ctx) {
      const msg = 'Context not loaded';
      set({ error: msg });
      throw new Error(msg);
    }
    const thinkingEnabled = useUiStore.getState().thinkingEnabled;
    try {
      const meta = await profilesApi.create({ name, context: ctx, thinkingEnabled });
      set((s) => ({ profiles: [meta, ...s.profiles], error: null }));
      return meta;
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  saveCurrentToActive: async () => {
    const activeId = get().activeProfileId;
    if (!activeId) {
      const msg = 'No active profile';
      set({ error: msg });
      throw new Error(msg);
    }
    return get().saveCurrentTo(activeId);
  },

  saveCurrentTo: async (id) => {
    const ctx = useContextStore.getState().getCurrentContext();
    if (!ctx) {
      const msg = 'Context not loaded';
      set({ error: msg });
      throw new Error(msg);
    }
    const existing = get().profiles.find((p) => p.id === id);
    if (!existing) {
      const msg = 'Profile not found';
      set({ error: msg });
      throw new Error(msg);
    }
    const thinkingEnabled = useUiStore.getState().thinkingEnabled;
    const body: ProfileRecord = {
      name: existing.name,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
      context: ctx,
      thinkingEnabled,
    };
    try {
      const meta = await profilesApi.update(id, body);
      set((s) => ({
        profiles: sortByUpdatedDesc(s.profiles.map((p) => (p.id === id ? meta : p))),
        error: null,
      }));
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  apply: async (id) => {
    try {
      const record = await profilesApi.get(id);
      await useContextStore.getState().bulkOverwrite(record.context);
      useUiStore.getState().setThinkingEnabled(record.thinkingEnabled);
      persistActive(id);
      set({ activeProfileId: id, error: null });
    } catch (e) {
      const msg = errMsg(e);
      if (/HTTP 404/i.test(msg) || /not found/i.test(msg)) {
        persistActive(null);
        if (get().activeProfileId === id) set({ activeProfileId: null });
        await get().init();
      }
      set({ error: msg });
      throw e;
    }
  },

  rename: async (id, name) => {
    const prev = get().profiles;
    const optimistic = prev.map((p) => (p.id === id ? { ...p, name } : p));
    set({ profiles: optimistic, error: null });
    try {
      const meta = await profilesApi.rename(id, name);
      set((s) => ({
        profiles: s.profiles.map((p) => (p.id === id ? meta : p)),
      }));
    } catch (e) {
      set({ profiles: prev, error: errMsg(e) });
      throw e;
    }
  },

  delete: async (id) => {
    try {
      await profilesApi.delete(id);
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
    const wasActive = get().activeProfileId === id;
    set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id), error: null }));
    if (wasActive) {
      persistActive(null);
      set({ activeProfileId: null });
    }
  },

  exportProfile: async (id) => {
    try {
      const record = await profilesApi.get(id);
      const json = JSON.stringify(record, null, 2);
      const safe = sanitizeFilename(record.name);
      const filename = `aether-profile-${safe}-${Date.now()}.json`;
      triggerDownload(filename, json);
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  importFile: async (file) => {
    if (file.size > MAX_FILE_BYTES) {
      const msg = 'File too large (max 5MB)';
      set({ error: msg });
      throw new Error(msg);
    }
    let parsed: unknown;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      const msg = 'Invalid JSON';
      set({ error: msg });
      throw new Error(msg);
    }
    try {
      const meta = await profilesApi.importJson(parsed);
      set((s) => ({ profiles: [meta, ...s.profiles], error: null }));
      return meta;
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },
}));
