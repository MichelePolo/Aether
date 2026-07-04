import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MessageList } from './MessageList';
import { useChatStore } from '@/src/stores/chat.store';

beforeEach(() => {
  useChatStore.getState()._reset();
});

describe('MessageList live-region behavior', () => {
  it('marks the streaming bubble aria-live=off and drops redundant aria-live on the log', () => {
    const id = 'm1';
    useChatStore.getState().hydrate([{ id, role: 'model', text: 'partial', timestamp: 0 }]);
    useChatStore.setState({ streamingId: id });
    const { container } = render(<MessageList onRetry={() => {}} />);
    const log = container.querySelector('[role="log"]')!;
    expect(log.getAttribute('aria-live')).toBeNull(); // role=log implies polite; explicit is redundant
    expect(container.querySelector('[aria-live="off"]')).not.toBeNull(); // streaming wrapper opts out
  });
});
