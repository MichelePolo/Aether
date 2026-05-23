import { create } from 'zustand';
import type { SessionHits } from '@/src/types/search.types';

const THINKING_KEY = 'aether.thinkingEnabled';
const SIDEBAR_KEY = 'aether.sidebarOpen';

interface UiState {
  reasoningDrawerOpen: boolean;
  thinkingEnabled: boolean;
  focusedMessageId: string | null;
  profilesModalOpen: boolean;
  paletteOpen: boolean;
  paletteMode: 'commands' | 'search';
  searchQuery: string;
  searchResults: SessionHits[];
  sidebarOpen: boolean;
  editingSubAgentId: string | null;
  messageContextMenu: { x: number; y: number; messageId: string; role: 'user' | 'model' } | null;
  lightboxAttachmentId: string | null;

  openSubAgentEditor: (id: string) => void;
  closeSubAgentEditor: () => void;

  openMessageContextMenu(payload: { x: number; y: number; messageId: string; role: 'user' | 'model' }): void;
  closeMessageContextMenu(): void;

  keyVaultOpen: boolean;
  keyVaultFocusTransport: 'anthropic' | 'openai' | 'gemini' | null;
  openKeyVault(focus?: 'anthropic' | 'openai' | 'gemini'): void;
  closeKeyVault(): void;
  openLightbox(id: string): void;
  closeLightbox(): void;

  toggleReasoningDrawer: () => void;
  openReasoningDrawer: () => void;
  closeReasoningDrawer: () => void;
  setThinkingEnabled: (v: boolean) => void;
  toggleThinking: () => void;
  setFocusedMessageId: (id: string | null) => void;
  openProfilesModal: () => void;
  closeProfilesModal: () => void;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  enterSearchMode: () => void;
  exitSearchMode: () => void;
  setSearchQuery: (q: string) => void;
  setSearchResults: (results: SessionHits[]) => void;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  initFromStorage: () => void;
  _reset: () => void;
}

const initial = {
  reasoningDrawerOpen: false,
  thinkingEnabled: false,
  focusedMessageId: null as string | null,
  profilesModalOpen: false,
  paletteOpen: false,
  paletteMode: 'commands' as 'commands' | 'search',
  searchQuery: '',
  searchResults: [] as SessionHits[],
  sidebarOpen: true,
  editingSubAgentId: null as string | null,
  messageContextMenu: null as { x: number; y: number; messageId: string; role: 'user' | 'model' } | null,
  keyVaultOpen: false,
  keyVaultFocusTransport: null as 'anthropic' | 'openai' | 'gemini' | null,
  lightboxAttachmentId: null as string | null,
};

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeBool(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    // ignore
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  ...initial,
  _reset: () => set(initial),

  toggleReasoningDrawer: () =>
    set((s) => ({ reasoningDrawerOpen: !s.reasoningDrawerOpen })),
  openReasoningDrawer: () => set({ reasoningDrawerOpen: true }),
  closeReasoningDrawer: () =>
    set({ reasoningDrawerOpen: false, focusedMessageId: null }),

  setThinkingEnabled: (v) => {
    writeBool(THINKING_KEY, v);
    set({ thinkingEnabled: v });
  },
  toggleThinking: () => {
    const next = !get().thinkingEnabled;
    writeBool(THINKING_KEY, next);
    set({ thinkingEnabled: next });
  },

  setFocusedMessageId: (id) => set({ focusedMessageId: id }),

  openProfilesModal: () => set({ profilesModalOpen: true }),
  closeProfilesModal: () => set({ profilesModalOpen: false }),

  openSubAgentEditor: (id) => set({ editingSubAgentId: id }),
  closeSubAgentEditor: () => set({ editingSubAgentId: null }),

  openMessageContextMenu: (payload) => set({ messageContextMenu: payload }),
  closeMessageContextMenu: () => set({ messageContextMenu: null }),

  openKeyVault: (focus) => set({ keyVaultOpen: true, keyVaultFocusTransport: focus ?? null }),
  closeKeyVault: () => set({ keyVaultOpen: false, keyVaultFocusTransport: null }),

  openLightbox: (id) => set({ lightboxAttachmentId: id }),
  closeLightbox: () => set({ lightboxAttachmentId: null }),

  openPalette: () =>
    set({ paletteOpen: true, paletteMode: 'commands', searchQuery: '', searchResults: [] }),
  closePalette: () =>
    set({ paletteOpen: false, paletteMode: 'commands', searchQuery: '', searchResults: [] }),
  togglePalette: () =>
    set((s) =>
      s.paletteOpen
        ? { paletteOpen: false, paletteMode: 'commands', searchQuery: '', searchResults: [] }
        : { paletteOpen: true, paletteMode: 'commands', searchQuery: '', searchResults: [] },
    ),
  enterSearchMode: () =>
    set({ paletteMode: 'search', searchQuery: '', searchResults: [] }),
  exitSearchMode: () =>
    set({ paletteMode: 'commands', searchQuery: '', searchResults: [] }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchResults: (results) => set({ searchResults: results }),

  setSidebarOpen: (v) => {
    writeBool(SIDEBAR_KEY, v);
    set({ sidebarOpen: v });
  },
  toggleSidebar: () => {
    const next = !get().sidebarOpen;
    writeBool(SIDEBAR_KEY, next);
    set({ sidebarOpen: next });
  },

  initFromStorage: () =>
    set({
      thinkingEnabled: readBool(THINKING_KEY, false),
      sidebarOpen: readBool(SIDEBAR_KEY, true),
    }),
}));
