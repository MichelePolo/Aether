import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';
import { useUiStore } from '@/src/stores/ui.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';

describe('MessageInput', () => {
  beforeEach(() => {
    useUiStore.getState()._reset();
    useSubAgentsStore.getState()._reset();
    localStorage.clear();
  });

  it('sends on Enter with trim', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onStop={() => {}} isStreaming={false} />);
    const ta = screen.getByRole('textbox');
    await userEvent.type(ta, '  hello  {Enter}');
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('does not send on empty/whitespace Enter', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onStop={() => {}} isStreaming={false} />);
    const ta = screen.getByRole('textbox');
    await userEvent.type(ta, '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Shift+Enter inserts newline', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onStop={() => {}} isStreaming={false} />);
    const ta = screen.getByRole<HTMLTextAreaElement>('textbox');
    await userEvent.type(ta, 'a{Shift>}{Enter}{/Shift}b');
    expect(onSend).not.toHaveBeenCalled();
    expect(ta.value).toBe('a\nb');
  });

  it('shows Send button when idle, Stop when streaming', () => {
    const { rerender } = render(
      <MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />,
    );
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
    rerender(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming />);
    expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('clicking Stop calls onStop', async () => {
    const onStop = vi.fn();
    render(<MessageInput onSend={() => {}} onStop={onStop} isStreaming />);
    await userEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalled();
  });

  it('textarea is disabled during streaming', () => {
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('clears textarea after successful send', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onStop={() => {}} isStreaming={false} />);
    const ta = screen.getByRole<HTMLTextAreaElement>('textbox');
    await userEvent.type(ta, 'hi{Enter}');
    expect(ta.value).toBe('');
  });

  it('Send button click also sends', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onStop={() => {}} isStreaming={false} />);
    await userEvent.type(screen.getByRole('textbox'), 'click-send');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith('click-send');
  });

  it('brain toggle reflects ui.store.thinkingEnabled', () => {
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
    const btn = screen.getByRole('button', { name: /thinking/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    act(() => {
      useUiStore.getState().setThinkingEnabled(true);
    });
    // re-render-on-state-change: with Zustand selectors, the component should re-render automatically
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking brain toggle flips thinkingEnabled', async () => {
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
    const btn = screen.getByRole('button', { name: /thinking/i });
    await userEvent.click(btn);
    expect(useUiStore.getState().thinkingEnabled).toBe(true);
    await userEvent.click(btn);
    expect(useUiStore.getState().thinkingEnabled).toBe(false);
  });

  it('opens mention popover when typing @', async () => {
    useSubAgentsStore.setState({
      list: [{ id: 'a', name: 'designer', createdAt: 1, updatedAt: 1 }],
      hydrated: true,
    });
    const user = userEvent.setup();
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
    const ta = screen.getByPlaceholderText(/scrivi un messaggio/i);
    await user.click(ta);
    await user.keyboard('@d');
    expect(screen.getByText('designer')).toBeInTheDocument();
  });

  it('selecting from popover inserts @name<space>', async () => {
    useSubAgentsStore.setState({
      list: [{ id: 'a', name: 'designer', createdAt: 1, updatedAt: 1 }],
      hydrated: true,
    });
    const user = userEvent.setup();
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
    const ta = screen.getByPlaceholderText(/scrivi un messaggio/i) as HTMLTextAreaElement;
    await user.click(ta);
    await user.keyboard('@des');
    await user.keyboard('{Enter}');
    expect(ta.value).toBe('@designer ');
  });
});
