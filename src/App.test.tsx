import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { useChatStore } from '@/src/stores/chat.store';
import { useContextStore } from '@/src/stores/context.store';

beforeEach(() => {
  useChatStore.getState()._reset();
  useContextStore.getState()._reset();
});

describe('App', () => {
  it('renders sidebar + ChatView, hydrates from /api/sessions/default', async () => {
    render(<App />);
    expect(screen.getByText('AETHER_CORE')).toBeInTheDocument();
    // l'EmptyState compare quando l'history idratata è vuota (default handler)
    await waitFor(() => {
      expect(screen.getByText(/Aether ready/i)).toBeInTheDocument();
    });
    // due textbox sono attesi (System Protocol + MessageInput): ChatView monta il suo input
    expect(screen.getByPlaceholderText(/Scrivi un messaggio/i)).toBeInTheDocument();
  });
});
