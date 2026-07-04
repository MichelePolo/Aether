import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReasoningDrawer } from './ReasoningDrawer';
import { useUiStore } from '@/src/stores/ui.store';
import { useChatStore } from '@/src/stores/chat.store';
import type { ReasoningStep } from '@/src/types/reasoning.types';

const step = (id: string, type: ReasoningStep['type'] = 'context_fetch', title = 't', content = 'c'): ReasoningStep => ({
  id, type, title, content, timestamp: 1,
});

beforeEach(() => {
  useUiStore.getState()._reset();
  useChatStore.getState()._reset();
});

describe('ReasoningDrawer (closed)', () => {
  it('renders no step content while closed, even with reasoning steps in the store', () => {
    useUiStore.setState({ reasoningDrawerOpen: false });
    useChatStore.setState({
      streamingId: null,
      messages: [
        { id: 'u', role: 'user', text: 'hi', timestamp: 0 },
        {
          id: 'm1', role: 'model', text: 'ok', timestamp: 1,
          reasoningSteps: [step('s1', 'validation', 'Validate', 'ok')],
        },
      ],
    });
    render(<ReasoningDrawer />);
    // The drawer stays mounted (translate-x-full + inert) for its slide
    // transition, but must not do the work of resolving/rendering steps
    // while closed.
    expect(screen.queryByText('Validate')).not.toBeInTheDocument();
  });

  it('renders no live-thinking content while closed during an active stream', () => {
    useUiStore.setState({ reasoningDrawerOpen: false });
    useChatStore.setState({
      streamingId: 'm1',
      messages: [{ id: 'm1', role: 'model', text: '', timestamp: 1 }],
      currentReasoning: { thinkingText: 'pondering', steps: [step('s1')] },
    });
    render(<ReasoningDrawer />);
    expect(screen.queryByText(/pondering/)).not.toBeInTheDocument();
  });
});
