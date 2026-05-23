import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BuiltinMcpToggles } from './BuiltinMcpToggles';
import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store';
import { useMcpStore } from '@/src/stores/mcp.store';

beforeEach(() => {
  useBuiltinMcpStore.getState()._reset();
  useMcpStore.getState()._reset();
});

describe('BuiltinMcpToggles', () => {
  it('renders 2 rows in fixed order (Filesystem, Terminal)', () => {
    useBuiltinMcpStore.setState({
      builtins: [
        { transport: 'filesystem', enabled: false, fsRoot: null },
        { transport: 'terminal', enabled: false, fsRoot: null },
      ],
    });
    render(<BuiltinMcpToggles />);
    const rows = screen.getAllByTestId('builtin-mcp-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Filesystem/i);
    expect(rows[1]).toHaveTextContent(/Terminal/i);
  });

  it('clicking the Filesystem toggle calls useBuiltinMcpStore.toggle', async () => {
    const toggleSpy = vi.fn(async () => {});
    useBuiltinMcpStore.setState({
      builtins: [
        { transport: 'filesystem', enabled: false, fsRoot: null },
        { transport: 'terminal', enabled: false, fsRoot: null },
      ],
      toggle: toggleSpy,
    });
    const user = userEvent.setup();
    render(<BuiltinMcpToggles />);
    await user.click(screen.getByLabelText(/toggle filesystem/i));
    expect(toggleSpy).toHaveBeenCalledWith('filesystem');
  });

  it('Filesystem row shows the current fsRoot or "default"', () => {
    useBuiltinMcpStore.setState({
      builtins: [
        { transport: 'filesystem', enabled: true, fsRoot: '/repo' },
        { transport: 'terminal', enabled: false, fsRoot: null },
      ],
    });
    render(<BuiltinMcpToggles />);
    expect(screen.getByText('/repo')).toBeInTheDocument();
  });

  it('shows "default" when fsRoot is null', () => {
    useBuiltinMcpStore.setState({
      builtins: [
        { transport: 'filesystem', enabled: true, fsRoot: null },
        { transport: 'terminal', enabled: false, fsRoot: null },
      ],
    });
    render(<BuiltinMcpToggles />);
    expect(screen.getByText(/default/i)).toBeInTheDocument();
  });

  it('status dot reflects useMcpStore connectStates for builtin:<transport>', () => {
    useBuiltinMcpStore.setState({
      builtins: [
        { transport: 'filesystem', enabled: true, fsRoot: null },
        { transport: 'terminal', enabled: false, fsRoot: null },
      ],
    });
    useMcpStore.setState({
      connectStates: { 'builtin:filesystem': 'online' },
    });
    render(<BuiltinMcpToggles />);
    const rows = screen.getAllByTestId('builtin-mcp-row');
    expect(rows[0].querySelector('[data-state="online"]')).not.toBeNull();
  });
});
