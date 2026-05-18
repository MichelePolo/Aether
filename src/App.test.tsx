import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import App from './App';
import { useChatStore } from '@/src/stores/chat.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';

beforeEach(() => {
  useChatStore.getState()._reset();
  useContextStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useUiStore.getState()._reset();
  localStorage.clear();
});

describe('App', () => {
  it('renders sidebar with SessionsSection, ChatView present after init', async () => {
    render(<App />);
    expect(screen.getByText('AETHER_CORE')).toBeInTheDocument();
    expect(screen.getByText(/Sessions/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Scrivi un messaggio/i)).toBeInTheDocument();
    });
  });

  it('mounts ReasoningDrawer (closed by default)', () => {
    render(<App />);
    expect(screen.queryByRole('complementary', { name: /reasoning/i })).not.toBeInTheDocument();
  });

  it('opens ReasoningDrawer when ui.store flips', async () => {
    render(<App />);
    act(() => {
      useUiStore.getState().openReasoningDrawer();
    });
    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: /reasoning/i })).toBeInTheDocument();
    });
  });
});
