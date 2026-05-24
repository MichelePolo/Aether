import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('ReasoningDrawer', () => {
  it('drawer is hidden when closed (translate-x-full)', () => {
    useUiStore.setState({ reasoningDrawerOpen: false });
    const { container } = render(<ReasoningDrawer />);
    const drawer = container.querySelector('aside');
    expect(drawer).not.toBeNull();
    expect(drawer!.className).toMatch(/translate-x-full/);
    expect(drawer!.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders when open with empty state', () => {
    useUiStore.setState({ reasoningDrawerOpen: true });
    render(<ReasoningDrawer />);
    expect(screen.getByRole('complementary', { name: /reasoning/i })).toBeInTheDocument();
    expect(screen.getByText(/No steps/i)).toBeInTheDocument();
  });

  it('close button calls closeReasoningDrawer', async () => {
    useUiStore.setState({ reasoningDrawerOpen: true });
    render(<ReasoningDrawer />);
    await userEvent.click(screen.getByRole('button', { name: /close reasoning drawer/i }));
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
  });

  it('live mode: shows LiveThinkingBlock + currentReasoning.steps', () => {
    useUiStore.setState({ reasoningDrawerOpen: true });
    useChatStore.setState({
      streamingId: 'm1',
      messages: [{ id: 'm1', role: 'model', text: '', timestamp: 1 }],
      currentReasoning: { thinkingText: 'pondering', steps: [step('s1')] },
    });
    render(<ReasoningDrawer />);
    expect(screen.getByText(/pondering/)).toBeInTheDocument();
    expect(screen.getByText('t')).toBeInTheDocument(); // step title
  });

  it('static mode: shows activeMessage.reasoningSteps after stream done', () => {
    useUiStore.setState({ reasoningDrawerOpen: true });
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
    expect(screen.getByText('Validate')).toBeInTheDocument();
  });

  it('focus resolution: focusedMessageId wins over streamingId', () => {
    useUiStore.setState({ reasoningDrawerOpen: true, focusedMessageId: 'm_old' });
    useChatStore.setState({
      streamingId: 'm_new',
      messages: [
        {
          id: 'm_old', role: 'model', text: 'old', timestamp: 0,
          reasoningSteps: [step('a', 'context_fetch', 'OldStep', 'old content')],
        },
        { id: 'm_new', role: 'model', text: '', timestamp: 1 },
      ],
      currentReasoning: { thinkingText: '', steps: [step('b', 'dispatch', 'NewStep', 'new content')] },
    });
    render(<ReasoningDrawer />);
    expect(screen.getByText('OldStep')).toBeInTheDocument();
    expect(screen.queryByText('NewStep')).not.toBeInTheDocument();
  });
});
