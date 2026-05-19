import { create } from 'zustand';

const THINKING_KEY = 'aether.thinkingEnabled';

interface UiState {
  reasoningDrawerOpen: boolean;
  thinkingEnabled: boolean;
  focusedMessageId: string | null;
  profilesModalOpen: boolean;

  toggleReasoningDrawer: () => void;
  openReasoningDrawer: () => void;
  closeReasoningDrawer: () => void;
  setThinkingEnabled: (v: boolean) => void;
  setFocusedMessageId: (id: string | null) => void;
  openProfilesModal: () => void;
  closeProfilesModal: () => void;
  initFromStorage: () => void;
  _reset: () => void;
}

const initial = {
  reasoningDrawerOpen: false,
  thinkingEnabled: false,
  focusedMessageId: null as string | null,
  profilesModalOpen: false,
};

function readStoredThinking(): boolean {
  try {
    return localStorage.getItem(THINKING_KEY) === '1';
  } catch {
    return false;
  }
}

function persistThinking(v: boolean): void {
  try {
    localStorage.setItem(THINKING_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
}

export const useUiStore = create<UiState>((set) => ({
  ...initial,
  _reset: () => set(initial),

  toggleReasoningDrawer: () =>
    set((s) => ({ reasoningDrawerOpen: !s.reasoningDrawerOpen })),
  openReasoningDrawer: () => set({ reasoningDrawerOpen: true }),
  closeReasoningDrawer: () =>
    set({ reasoningDrawerOpen: false, focusedMessageId: null }),

  setThinkingEnabled: (v) => {
    persistThinking(v);
    set({ thinkingEnabled: v });
  },

  setFocusedMessageId: (id) => set({ focusedMessageId: id }),

  openProfilesModal: () => set({ profilesModalOpen: true }),
  closeProfilesModal: () => set({ profilesModalOpen: false }),

  initFromStorage: () => set({ thinkingEnabled: readStoredThinking() }),
}));
