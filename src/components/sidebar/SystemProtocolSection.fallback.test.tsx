import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemProtocolSection } from './SystemProtocolSection';
import { useContextStore } from '@/src/stores/context.store';

// The editor element never becomes available (still loading, or the chunk failed).
vi.mock('@/src/lib/markdown/elements', () => ({
  EDITOR_CONFIG: 'aether',
  useMarkdownElements: () => false,
}));

beforeEach(() => {
  useContextStore.setState({
    context: { systemInstruction: 'initial', skills: [], tools: [], mcpServers: [] },
    isLoading: false,
    error: null,
  });
});

describe('SystemProtocolSection without the Markdown editor', () => {
  it('falls back to a plain textarea that saves on blur', async () => {
    const user = userEvent.setup();
    const setSystemInstruction = vi.fn(async () => {});
    useContextStore.setState({ setSystemInstruction });

    const { container } = render(<SystemProtocolSection />);
    expect(container.querySelector('mdlib-editor')).toBeNull();
    const ta = screen.getByLabelText('System instruction');
    expect(ta).toHaveValue('initial');
    await user.clear(ta);
    await user.type(ta, 'Plain');
    await user.tab();
    expect(setSystemInstruction).toHaveBeenCalledWith('Plain');
  });
});
