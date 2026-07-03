import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';
import { useChatStore } from '@/src/stores/chat.store';

describe('MessageInput — attachment error', () => {
  beforeEach(() => {
    useChatStore.getState()._reset();
  });

  it('renders a queued attachment error in a role=alert region', () => {
    useChatStore.setState({ error: 'a.pdf is too large — total attachments must stay under 10 MB.' });
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/too large/i);
  });

  it('does not render an alert region when there is no error', () => {
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears a stale attachment error once a message is sent successfully', async () => {
    useChatStore.setState({ error: 'a.pdf is too large — total attachments must stay under 10 MB.' });
    const user = userEvent.setup();
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    const ta = screen.getByPlaceholderText(/type a message/i);
    await user.type(ta, 'hello there');
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(useChatStore.getState().error).toBeNull();
  });

  it('clears the error when the dismiss button is clicked', async () => {
    useChatStore.setState({ error: 'a.pdf is too large — total attachments must stay under 10 MB.' });
    const user = userEvent.setup();
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const dismiss = screen.getByRole('button', { name: /dismiss error/i });
    await user.click(dismiss);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(useChatStore.getState().error).toBeNull();
  });
});
