import { create } from 'zustand';
import type { MaterialSkill, DraftSkill } from '@/server/domain/skills/skills.types';
import { skillsApi } from '@/src/lib/api/skills.api';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface SkillsState {
  skills: MaterialSkill[];
  drafts: DraftSkill[];
  paths: { skillsDir: string; draftsDir: string } | null;
  isLoading: boolean;
  error: string | null;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  toggleEnabled: (slug: string) => Promise<void>;
  togglePinned: (slug: string) => Promise<void>;
  promote: (slug: string) => Promise<void>;
  remove: (slug: string) => Promise<void>;
  /** SKILL.md for the editor; null (and `error` set) if it can't be read. */
  readContent: (slug: string, draft?: boolean) => Promise<string | null>;
  /** Saves SKILL.md, then refreshes the list (descriptions may change). Throws on failure. */
  saveContent: (slug: string, content: string, draft?: boolean) => Promise<void>;
  clearError: () => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  drafts: [],
  paths: null,
  isLoading: false,
  error: null,

  init: async () => {
    set({ isLoading: true, error: null });
    try {
      const { skills, drafts, paths } = await skillsApi.list();
      set({ skills, drafts, paths, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: errMsg(e) });
    }
  },

  refresh: async () => {
    const { skills, drafts, paths } = await skillsApi.list();
    set({ skills, drafts, paths, error: null });
  },

  toggleEnabled: async (slug) => {
    const prev = get().skills;
    const target = prev.find((s) => s.name === slug);
    if (!target) return;
    const next = !target.enabled;
    set({ skills: prev.map((s) => (s.name === slug ? { ...s, enabled: next } : s)), error: null });
    try {
      await skillsApi.setEnabled(slug, next);
    } catch (e) {
      set({ skills: prev, error: errMsg(e) });
      throw e;
    }
  },

  togglePinned: async (slug) => {
    const prev = get().skills;
    const target = prev.find((s) => s.name === slug);
    if (!target) return;
    const next = !target.pinned;
    set({ skills: prev.map((s) => (s.name === slug ? { ...s, pinned: next } : s)), error: null });
    try {
      await skillsApi.setPinned(slug, next);
    } catch (e) {
      set({ skills: prev, error: errMsg(e) });
      throw e;
    }
  },

  promote: async (slug) => {
    try {
      await skillsApi.promote(slug);
      await get().refresh();
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  remove: async (slug) => {
    const prev = get().skills;
    set({ skills: prev.filter((s) => s.name !== slug), error: null });
    try {
      await skillsApi.remove(slug);
    } catch (e) {
      set({ skills: prev, error: errMsg(e) });
      throw e;
    }
  },

  readContent: async (slug, draft = false) => {
    try {
      return await skillsApi.getContent(slug, draft);
    } catch (e) {
      set({ error: errMsg(e) });
      return null;
    }
  },

  saveContent: async (slug, content, draft = false) => {
    await skillsApi.putContent(slug, content, draft);
    await get().refresh();
  },

  clearError: () => set({ error: null }),
}));
