import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemProtocolSection } from './SystemProtocolSection';
import { useContextStore } from '@/src/stores/context.store';

beforeEach(() => {
  useContextStore.setState({
    context: { systemInstruction: 'initial', skills: [], tools: [], mcpServers: [] },
    isLoading: false,
    error: null,
  });
});

describe('SystemProtocolSection', () => {
  it('shows current system instruction', () => {
    render(<SystemProtocolSection />);
    expect(screen.getByLabelText('System instruction')).toHaveValue('initial');
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
});
