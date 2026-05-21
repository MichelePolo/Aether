import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '@/src/stores/chat.store';
import { useUiStore } from '@/src/stores/ui.store';
import type { ReasoningStep } from '@/src/types/reasoning.types';

beforeEach(() => {
  useChatStore.getState()._reset();
  useUiStore.getState()._reset();
});

interface SeedInput {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp?: number;
  error?: string;
  retryable?: boolean;
  interrupted?: boolean;
  model?: string;
  reasoningSteps?: ReasoningStep[];
}

function seed(msg: SeedInput) {
  useChatStore.getState().hydrate([{ timestamp: 0, ...msg }]);
}

describe('MessageBubble', () => {
  it('renders user message as plain text', () => {
    seed({ id: 'u1', role: 'user', text: 'Hello **world**' });
    render(<MessageBubble id="u1" />);
    // user messages: niente markdown rendering, testo puro
    expect(screen.getByText('Hello **world**')).toBeInTheDocument();
  });

  it('renders model message with markdown', () => {
    seed({ id: 'm1', role: 'model', text: 'Hello **bold**' });
    render(<MessageBubble id="m1" />);
    const strong = screen.getByText('bold');
    expect(strong.tagName).toBe('STRONG');
  });

  it('shows error footer with Retry when retryable=true', async () => {
    const onRetry = vi.fn();
    seed({ id: 'e1', role: 'model', text: 'partial', error: 'Network down', retryable: true });
    render(<MessageBubble id="e1" onRetry={onRetry} />);
    expect(screen.getByText(/Network down/)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /retry/i });
    await userEvent.click(btn);
    expect(onRetry).toHaveBeenCalledWith('e1');
  });

  it('shows error footer without Retry when retryable=false', () => {
    seed({ id: 'e2', role: 'model', text: 'x', error: 'Bad API key', retryable: false });
    render(<MessageBubble id="e2" onRetry={() => {}} />);
    expect(screen.getByText(/Bad API key/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('shows interrupted label when interrupted (no error)', () => {
    seed({ id: 'i1', role: 'model', text: 'half', interrupted: true });
    render(<MessageBubble id="i1" />);
    expect(screen.getByText(/Interrotto/i)).toBeInTheDocument();
  });

  it('shows Riprendi button + token estimate when interrupted and text non-empty', () => {
    // 23 chars / 4 = 5.75 → ceil = 6
    seed({ id: 'i1', role: 'model', text: 'partial text 0123456789', interrupted: true });
    render(<MessageBubble id="i1" />);
    expect(screen.getByText(/~6 token/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /riprendi la risposta/i })).toBeInTheDocument();
  });

  it('does NOT render Riprendi button when interrupted text is empty', () => {
    seed({ id: 'i1', role: 'model', text: '', interrupted: true });
    render(<MessageBubble id="i1" />);
    expect(screen.getByText(/Interrotto/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /riprendi/i })).not.toBeInTheDocument();
  });

  it('does NOT render Riprendi when message has error (Retry takes precedence)', () => {
    seed({
      id: 'i1',
      role: 'model',
      text: 'partial',
      interrupted: true,
      error: 'boom',
      retryable: true,
    });
    render(<MessageBubble id="i1" onRetry={() => {}} />);
    expect(screen.queryByRole('button', { name: /riprendi/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('Riprendi button is disabled while another stream is in progress', () => {
    seed({ id: 'i1', role: 'model', text: 'partial', interrupted: true });
    useChatStore.setState({ streamingId: 'someOtherId' });
    render(<MessageBubble id="i1" />);
    expect(screen.getByRole('button', { name: /riprendi/i })).toBeDisabled();
  });

  it('shows StreamingIndicator only while streaming this message', () => {
    seed({ id: 'm2', role: 'model', text: '' });
    // simula streamingId == m2
    useChatStore.setState({ streamingId: 'm2' });
    render(<MessageBubble id="m2" />);
    expect(screen.getByLabelText('streaming')).toBeInTheDocument();
  });

  it('renders empty model bubble with placeholder text', () => {
    seed({ id: 'z', role: 'model', text: '' });
    render(<MessageBubble id="z" />);
    expect(screen.getByText(/empty response/i)).toBeInTheDocument();
  });

  it('shows "💭 thinking…" badge when streaming this message AND thinkingText has content', () => {
    seed({ id: 'mt', role: 'model', text: '' });
    useChatStore.setState({
      streamingId: 'mt',
      currentReasoning: { thinkingText: 'pondering', steps: [] },
    });
    render(<MessageBubble id="mt" />);
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  });

  it('shows "🧠 N steps" badge when message.reasoningSteps non-empty (post-stream)', () => {
    seed({
      id: 'ms', role: 'model', text: 'done',
      reasoningSteps: [
        { id: 'a', type: 'context_fetch', title: 't', content: 'c', timestamp: 1 },
        { id: 'b', type: 'dispatch', title: 't', content: 'c', timestamp: 1 },
      ],
    });
    render(<MessageBubble id="ms" />);
    expect(screen.getByText(/2 steps/i)).toBeInTheDocument();
  });

  it('clicking the steps badge opens drawer and sets focusedMessageId', async () => {
    seed({
      id: 'mb', role: 'model', text: 'done',
      reasoningSteps: [{ id: 'a', type: 'context_fetch', title: 't', content: 'c', timestamp: 1 }],
    });
    render(<MessageBubble id="mb" />);
    await userEvent.click(screen.getByRole('button', { name: /show reasoning/i }));
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(true);
    expect(useUiStore.getState().focusedMessageId).toBe('mb');
  });

  it('no badge when message has no reasoning and not streaming', () => {
    seed({ id: 'noreasoning', role: 'model', text: 'done' });
    render(<MessageBubble id="noreasoning" />);
    expect(screen.queryByRole('button', { name: /show reasoning/i })).not.toBeInTheDocument();
  });
});
