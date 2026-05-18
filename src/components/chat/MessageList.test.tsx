import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from './MessageList';
import { useChatStore } from '@/src/stores/chat.store';

beforeEach(() => {
  useChatStore.getState()._reset();
});

describe('MessageList', () => {
  it('shows EmptyState when no messages', () => {
    render(<MessageList onRetry={() => {}} />);
    expect(screen.getByText(/Aether ready/i)).toBeInTheDocument();
  });

  it('renders one bubble per message', () => {
    useChatStore.getState().hydrate([
      { id: '1', role: 'user', text: 'hello', timestamp: 1 },
      { id: '2', role: 'model', text: 'world', timestamp: 2 },
    ]);
    render(<MessageList onRetry={() => {}} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('world')).toBeInTheDocument();
  });
});
