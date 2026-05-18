import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { useChatStore } from '@/src/stores/chat.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

beforeEach(() => {
  useChatStore.getState()._reset();
  useContextStore.getState()._reset();
  useSessionsStore.getState()._reset();
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
});
