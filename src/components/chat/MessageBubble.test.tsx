import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  tokensIn?: number;
  tokensOut?: number;
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
    expect(screen.getByText(/Interrupted/i)).toBeInTheDocument();
  });

  it('shows Riprendi button + token estimate when interrupted and text non-empty', () => {
    // 23 chars / 4 = 5.75 → ceil = 6
    seed({ id: 'i1', role: 'model', text: 'partial text 0123456789', interrupted: true });
    render(<MessageBubble id="i1" />);
    expect(screen.getByText(/~6 tokens/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
  });

  it('does NOT render Riprendi button when interrupted text is empty', () => {
    seed({ id: 'i1', role: 'model', text: '', interrupted: true });
    render(<MessageBubble id="i1" />);
    expect(screen.getByText(/Interrupted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('Riprendi button is disabled while another stream is in progress', () => {
    seed({ id: 'i1', role: 'model', text: 'partial', interrupted: true });
    useChatStore.setState({ streamingId: 'someOtherId' });
    render(<MessageBubble id="i1" />);
    expect(screen.getByRole('button', { name: /resume/i })).toBeDisabled();
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

  it('right-click on user bubble opens menu with role=user and correct coords', () => {
    seed({ id: 'u1', role: 'user', text: 'Hello' });
    render(<MessageBubble id="u1" />);
    const bubble = screen.getByText('Hello').closest('div')!;
    fireEvent.contextMenu(bubble, { clientX: 150, clientY: 200 });
    const menu = useUiStore.getState().messageContextMenu;
    expect(menu).not.toBeNull();
    expect(menu?.role).toBe('user');
    expect(menu?.messageId).toBe('u1');
    expect(menu?.x).toBe(150);
    expect(menu?.y).toBe(200);
  });

  it('right-click on model bubble opens menu with role=model', () => {
    seed({ id: 'm1', role: 'model', text: 'Hi there' });
    render(<MessageBubble id="m1" />);
    const wrapper = document.querySelector('.max-w-\\[65ch\\]') as HTMLElement;
    fireEvent.contextMenu(wrapper, { clientX: 50, clientY: 60 });
    const menu = useUiStore.getState().messageContextMenu;
    expect(menu?.role).toBe('model');
    expect(menu?.messageId).toBe('m1');
  });

  it('assistant bubble with tokens sets title attribute', () => {
    seed({ id: 'tok', role: 'model', text: 'reply', tokensIn: 80, tokensOut: 40 });
    render(<MessageBubble id="tok" />);
    const wrapper = document.querySelector('.max-w-\\[65ch\\]') as HTMLElement;
    expect(wrapper.title).toMatch(/Prompt: 80/);
    expect(wrapper.title).toMatch(/Reply: 40/);
  });

  it('user bubble has no title attribute', () => {
    seed({ id: 'usr', role: 'user', text: 'Hello' });
    render(<MessageBubble id="usr" />);
    const wrapper = document.querySelector('.max-w-\\[65ch\\]') as HTMLElement;
    expect(wrapper.title ?? '').toBe('');
  });
});

describe('MessageBubble — attachments rendering', () => {
  beforeEach(() => {
    useChatStore.getState()._reset();
    useUiStore.getState()._reset();
  });

  it('renders an <img> for image attachments', () => {
    useChatStore.setState({
      messages: [{
        id: 'U1', role: 'user', text: 'look', timestamp: 0,
        attachments: [{ id: 'a1', mime: 'image/png', name: 'p.png', size: 4 }],
      }],
    });
    render(<MessageBubble id="U1" />);
    const img = screen.getByRole('img', { name: /p\.png/i });
    expect(img.getAttribute('src')).toBe('/api/attachments/a1');
  });

  it('renders a chip for text attachments', () => {
    useChatStore.setState({
      messages: [{
        id: 'U1', role: 'user', text: 'see notes', timestamp: 0,
        attachments: [{ id: 'a2', mime: 'text/markdown', name: 'notes.md', size: 100 }],
      }],
    });
    render(<MessageBubble id="U1" />);
    expect(screen.getByText(/notes\.md/i)).toBeInTheDocument();
  });

  it('clicking an image thumb opens the lightbox', async () => {
    useChatStore.setState({
      messages: [{
        id: 'U1', role: 'user', text: '', timestamp: 0,
        attachments: [{ id: 'a1', mime: 'image/png', name: 'p.png', size: 4 }],
      }],
    });
    const user = userEvent.setup();
    render(<MessageBubble id="U1" />);
    await user.click(screen.getByRole('img', { name: /p\.png/i }));
    expect(useUiStore.getState().lightboxAttachmentId).toBe('a1');
  });
});
