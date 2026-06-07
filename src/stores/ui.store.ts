import { create } from 'zustand';
import type { SessionHits } from '@/src/types/search.types';
import type { ToolCallRequestEvent } from '@/src/hooks/useToolCallDecisions';
import type { PreviewResult } from '@/src/types/breakpoints.types';

const THINKING_KEY = 'aether.thinkingEnabled';
const SIDEBAR_KEY = 'aether.sidebarOpen';
const MAINVIEW_KEY = 'aether.mainView';

export type MainView = 'chat' | 'history';

interface UiState {
  reasoningDrawerOpen: boolean;
  thinkingEnabled: boolean;
  mainView: MainView;
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

  ollamaEndpointsOpen: boolean;
  openOllamaEndpoints(): void;
  closeOllamaEndpoints(): void;

  workspaceBrowserOpen: boolean;
  openWorkspaceBrowser(): void;
  closeWorkspaceBrowser(): void;
  openLightbox(id: string): void;
  closeLightbox(): void;

  approvalGateState: { event: ToolCallRequestEvent; preview: PreviewResult } | null;
  openApprovalGate(payload: { event: ToolCallRequestEvent; preview: PreviewResult }): void;
  closeApprovalGate(): void;

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
  setMainView: (v: MainView) => void;
  toggleMainView: () => void;
  initFromStorage: () => void;
  _reset: () => void;
}

const initial = {
  reasoningDrawerOpen: false,
  thinkingEnabled: false,
  mainView: 'chat' as MainView,
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
  ollamaEndpointsOpen: false,
  lightboxAttachmentId: null as string | null,
  approvalGateState: null as { event: ToolCallRequestEvent; preview: PreviewResult } | null,
  workspaceBrowserOpen: false,
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

  openOllamaEndpoints: () => set({ ollamaEndpointsOpen: true }),
  closeOllamaEndpoints: () => set({ ollamaEndpointsOpen: false }),

  openWorkspaceBrowser: () => set({ workspaceBrowserOpen: true }),
  closeWorkspaceBrowser: () => set({ workspaceBrowserOpen: false }),

  openLightbox: (id) => set({ lightboxAttachmentId: id }),
  closeLightbox: () => set({ lightboxAttachmentId: null }),

  openApprovalGate: (payload) => set({ approvalGateState: payload }),
  closeApprovalGate: () => set({ approvalGateState: null }),

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

  setMainView: (v) => {
    try {
      localStorage.setItem(MAINVIEW_KEY, v);
    } catch {
      // ignore
    }
    set({ mainView: v });
  },
  toggleMainView: () => {
    const next: MainView = get().mainView === 'history' ? 'chat' : 'history';
    try {
      localStorage.setItem(MAINVIEW_KEY, next);
    } catch {
      // ignore
    }
    set({ mainView: next });
  },

  initFromStorage: () =>
    set({
      thinkingEnabled: readBool(THINKING_KEY, false),
      sidebarOpen: readBool(SIDEBAR_KEY, true),
      mainView: readMainView(),
    }),
}));

function readMainView(): MainView {
  try {
    return localStorage.getItem(MAINVIEW_KEY) === 'history' ? 'history' : 'chat';
  } catch {
    return 'chat';
  }
}
