import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';
import { useUiStore } from '@/src/stores/ui.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useChatStore } from '@/src/stores/chat.store';

describe('MessageInput', () => {
  beforeEach(() => {
    useUiStore.getState()._reset();
    useSubAgentsStore.getState()._reset();
    useProvidersStore.getState()._reset();
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
    const ta = screen.getByPlaceholderText(/type a message/i);
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
    const ta = screen.getByPlaceholderText(/type a message/i) as HTMLTextAreaElement;
    await user.click(ta);
    await user.keyboard('@des');
    await user.keyboard('{Enter}');
    expect(ta.value).toBe('@designer ');
  });

  it('disables Brain button when active provider lacks thinking capability', () => {
    useProvidersStore.setState({
      list: [{
        name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
        capabilities: { thinking: false, toolCalling: true, vision: false }, displayName: 'Ollama / llama3',
      }],
      defaultProvider: 'ollama:llama3',
      hydrated: true,
      error: null,
    });
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
    expect(screen.getByRole('button', { name: /toggle thinking/i })).toBeDisabled();
  });

  it('enables Brain button when active provider supports thinking', () => {
    useProvidersStore.setState({
      list: [{
        name: 'fake:default', transport: 'fake', model: 'default',
        capabilities: { thinking: true, toolCalling: true, vision: false }, displayName: 'Fake',
      }],
      defaultProvider: 'fake:default',
      hydrated: true,
      error: null,
    });
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
    expect(screen.getByRole('button', { name: /toggle thinking/i })).not.toBeDisabled();
  });
});

describe('MessageInput — attachments', () => {
  beforeEach(() => {
    useChatStore.getState()._reset();
    useProvidersStore.getState()._reset();
  });

  it('the "+" menu "Add files" action opens the hidden file input', async () => {
    const user = userEvent.setup();
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    await user.click(screen.getByRole('button', { name: /add to message/i }));
    await user.click(screen.getByRole('menuitem', { name: /add files or photos/i }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('selecting files via input calls queueAttachments', async () => {
    const queueSpy = vi.fn(async () => {});
    useChatStore.setState({ queueAttachments: queueSpy });
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(queueSpy).toHaveBeenCalled();
  });

  it('paste dispatches queueAttachments when clipboardData.files has entries', async () => {
    const queueSpy = vi.fn(async () => {});
    useChatStore.setState({ queueAttachments: queueSpy });
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const textarea = screen.getByPlaceholderText(/type a message/i);
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.paste(textarea, { clipboardData: { files: [file] } });
    expect(queueSpy).toHaveBeenCalledWith([file]);
  });

  it('Send button disabled when images queued + provider has vision=false', () => {
    useChatStore.setState({
      queuedAttachments: [{ id: 'q1', name: 'a.png', mime: 'image/png', size: 1, base64: 'AA==', dataUri: 'data:image/png;base64,AA==' }],
    });
    useProvidersStore.setState({
      list: [{ name: 'fake:default', transport: 'fake', model: 'fake-1', capabilities: { thinking: false, toolCalling: false, vision: false }, displayName: 'Fake' }],
      defaultProvider: 'fake:default',
      hydrated: true,
      error: null,
    });
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const sendBtn = screen.getByLabelText(/^Send$/i);
    expect(sendBtn).toBeDisabled();
  });

  it('Send button enabled when only text in textarea (no attachments)', async () => {
    const user = userEvent.setup();
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const textarea = screen.getByPlaceholderText(/type a message/i);
    await user.type(textarea, 'hello');
    const sendBtn = screen.getByLabelText(/^Send$/i);
    expect(sendBtn).not.toBeDisabled();
  });
});
