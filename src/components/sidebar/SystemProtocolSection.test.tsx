import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemProtocolSection } from './SystemProtocolSection';
import { useContextStore } from '@/src/stores/context.store';
import { ensureMarkdownElements } from '@/src/lib/markdown/elements';

// Define <mdlib-editor> up front so the component renders the real editor
// (the plain-textarea fallback is covered in SystemProtocolSection.fallback.test.tsx).
beforeAll(() => ensureMarkdownElements());

beforeEach(() => {
  useContextStore.setState({
    context: { systemInstruction: 'initial', skills: [], tools: [], mcpServers: [] },
    isLoading: false,
    error: null,
  });
});

describe('SystemProtocolSection', () => {
  it('shows the current system instruction in the Markdown editor', () => {
    const { container } = render(<SystemProtocolSection />);
    expect(container.querySelector('mdlib-editor')).toHaveAttribute('view', 'write');
    expect(screen.getByLabelText('System instruction')).toHaveValue('initial');
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
  });

  it('saves on blur when value has changed', async () => {
    const user = userEvent.setup();
    const setSystemInstruction = vi.fn(async (v: string) => {
      useContextStore.setState((s) => ({
        context: s.context ? { ...s.context, systemInstruction: v } : null,
      }));
    });
    useContextStore.setState({ setSystemInstruction });

    render(<SystemProtocolSection />);
    const ta = screen.getByLabelText('System instruction');
    await user.clear(ta);
    await user.type(ta, 'Updated');
    await user.tab();
    expect(setSystemInstruction).toHaveBeenCalledWith('Updated');
    expect(ta).toHaveValue('Updated');
  });

  it('does not save on blur when value unchanged', async () => {
    const user = userEvent.setup();
    const setSystemInstruction = vi.fn();
    useContextStore.setState({ setSystemInstruction });
    render(<SystemProtocolSection />);
    const ta = screen.getByLabelText('System instruction');
    await user.click(ta);
    await user.tab();
    expect(setSystemInstruction).not.toHaveBeenCalled();
  });

  it('shows a value replaced outside the editor (e.g. a profile switch)', () => {
    render(<SystemProtocolSection />);
    act(() => {
      useContextStore.setState((s) => ({
        context: s.context ? { ...s.context, systemInstruction: 'From profile' } : null,
      }));
    });
    expect(screen.getByLabelText('System instruction')).toHaveValue('From profile');
  });
});
