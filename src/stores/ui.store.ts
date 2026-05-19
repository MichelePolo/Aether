import { create } from 'zustand';

const THINKING_KEY = 'aether.thinkingEnabled';
const SIDEBAR_KEY = 'aether.sidebarOpen';

interface UiState {
  reasoningDrawerOpen: boolean;
  thinkingEnabled: boolean;
  focusedMessageId: string | null;
  profilesModalOpen: boolean;
  paletteOpen: boolean;
  sidebarOpen: boolean;

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
  sidebarOpen: true,
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

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

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
