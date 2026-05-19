import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from './ui.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  localStorage.clear();
});

describe('useUiStore.reasoningDrawer', () => {
  it('starts closed by default', () => {
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
  });

  it('openReasoningDrawer sets to true; closeReasoningDrawer to false', () => {
    useUiStore.getState().openReasoningDrawer();
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(true);
    useUiStore.getState().closeReasoningDrawer();
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
  });

  it('closeReasoningDrawer clears focusedMessageId', () => {
    useUiStore.setState({ reasoningDrawerOpen: true, focusedMessageId: 'm1' });
    useUiStore.getState().closeReasoningDrawer();
    expect(useUiStore.getState().focusedMessageId).toBeNull();
  });

  it('toggleReasoningDrawer flips state', () => {
    useUiStore.getState().toggleReasoningDrawer();
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(true);
    useUiStore.getState().toggleReasoningDrawer();
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
  });
});

describe('useUiStore.thinkingEnabled', () => {
  it('defaults to false when no localStorage', () => {
    expect(useUiStore.getState().thinkingEnabled).toBe(false);
  });

  it('setThinkingEnabled persists to localStorage', () => {
    useUiStore.getState().setThinkingEnabled(true);
    expect(useUiStore.getState().thinkingEnabled).toBe(true);
    expect(localStorage.getItem('aether.thinkingEnabled')).toBe('1');
    useUiStore.getState().setThinkingEnabled(false);
    expect(localStorage.getItem('aether.thinkingEnabled')).toBe('0');
  });

  it('initFromStorage reads existing value', () => {
    localStorage.setItem('aether.thinkingEnabled', '1');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().thinkingEnabled).toBe(true);
  });

  it('initFromStorage tolerates missing/corrupt values', () => {
    localStorage.setItem('aether.thinkingEnabled', 'garbage');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().thinkingEnabled).toBe(false);
  });
});

describe('useUiStore.focusedMessageId', () => {
  it('starts null', () => {
    expect(useUiStore.getState().focusedMessageId).toBeNull();
  });

  it('setFocusedMessageId stores and clears', () => {
    useUiStore.getState().setFocusedMessageId('m1');
    expect(useUiStore.getState().focusedMessageId).toBe('m1');
    useUiStore.getState().setFocusedMessageId(null);
    expect(useUiStore.getState().focusedMessageId).toBeNull();
  });
});

describe('useUiStore.profilesModal', () => {
  it('starts closed by default', () => {
    expect(useUiStore.getState().profilesModalOpen).toBe(false);
  });

  it('openProfilesModal sets true; closeProfilesModal sets false', () => {
    useUiStore.getState().openProfilesModal();
    expect(useUiStore.getState().profilesModalOpen).toBe(true);
    useUiStore.getState().closeProfilesModal();
    expect(useUiStore.getState().profilesModalOpen).toBe(false);
  });

  it('_reset sets profilesModalOpen back to false', () => {
    useUiStore.getState().openProfilesModal();
    useUiStore.getState()._reset();
    expect(useUiStore.getState().profilesModalOpen).toBe(false);
  });
});

describe('useUiStore.palette', () => {
  it('paletteOpen defaults false; open/close/toggle work', () => {
    const s = useUiStore.getState();
    expect(s.paletteOpen).toBe(false);
    s.openPalette();
    expect(useUiStore.getState().paletteOpen).toBe(true);
    s.closePalette();
    expect(useUiStore.getState().paletteOpen).toBe(false);
    s.togglePalette();
    expect(useUiStore.getState().paletteOpen).toBe(true);
    s.togglePalette();
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });
});

describe('useUiStore.sidebar', () => {
  it('sidebarOpen defaults true; toggle flips and persists', () => {
    const s = useUiStore.getState();
    expect(s.sidebarOpen).toBe(true);
    s.toggleSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    expect(localStorage.getItem('aether.sidebarOpen')).toBe('0');
    s.setSidebarOpen(true);
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    expect(localStorage.getItem('aether.sidebarOpen')).toBe('1');
  });

  it('initFromStorage hydrates sidebarOpen from "0" and falls back to true on garbage', () => {
    localStorage.setItem('aether.sidebarOpen', '0');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().sidebarOpen).toBe(false);

    localStorage.setItem('aether.sidebarOpen', 'garbage');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().sidebarOpen).toBe(true);

    localStorage.removeItem('aether.sidebarOpen');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().sidebarOpen).toBe(true);
  });
});

describe('useUiStore.toggleThinking', () => {
  it('toggleThinking flips thinkingEnabled and persists', () => {
    expect(useUiStore.getState().thinkingEnabled).toBe(false);
    useUiStore.getState().toggleThinking();
    expect(useUiStore.getState().thinkingEnabled).toBe(true);
    expect(localStorage.getItem('aether.thinkingEnabled')).toBe('1');
    useUiStore.getState().toggleThinking();
    expect(useUiStore.getState().thinkingEnabled).toBe(false);
    expect(localStorage.getItem('aether.thinkingEnabled')).toBe('0');
  });
});
