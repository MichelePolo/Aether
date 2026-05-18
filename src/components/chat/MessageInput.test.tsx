import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';

describe('MessageInput', () => {
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
});
