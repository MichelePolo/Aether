import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpServersSection } from './McpServersSection';
import { useContextStore } from '@/src/stores/context.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { _resetDialogStore } from '@/src/hooks/useDialog';

beforeEach(() => {
  _resetDialogStore();
  useMcpStore.getState()._reset();
  useContextStore.setState({
    context: { systemInstruction: '', skills: [], tools: [], mcpServers: [] },
    isLoading: false,
    error: null,
    addMcpServer: async (input) => {
      useContextStore.setState((s) => ({
        context: s.context
          ? { ...s.context, mcpServers: [...s.context.mcpServers, { ...input, id: 'm-new' }] }
          : null,
      }));
    },
    removeMcpServer: async (id) => {
      useContextStore.setState((s) => ({
        context: s.context
          ? { ...s.context, mcpServers: s.context.mcpServers.filter((srv) => srv.id !== id) }
          : null,
      }));
    },
  });
});

describe('McpServersSection', () => {
  it('shows empty state when no servers', () => {
    render(<><DialogHost /><McpServersSection /></>);
    expect(screen.getByText(/no active mcp/i)).toBeInTheDocument();
  });

  it('adds a server via 2-step prompt', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><McpServersSection /></>);
    await user.click(screen.getByRole('button', { name: /add mcp server/i }));
    // step 1: name
    await user.type(screen.getByRole('textbox'), 'TestSrv');
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    // step 2: url (default)
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.mcpServers).toContainEqual(
      expect.objectContaining({ name: 'TestSrv', status: 'connecting' }),
    );
  });

  it('lists existing server with name + url', () => {
    useContextStore.setState((s) => ({
      context: s.context
        ? {
            ...s.context,
            mcpServers: [{ id: 'm1', name: 'Prod', url: 'http://prod', status: 'online' }],
          }
        : null,
    }));
    render(<><DialogHost /><McpServersSection /></>);
    expect(screen.getByText('Prod')).toBeInTheDocument();
    expect(screen.getByText('http://prod')).toBeInTheDocument();
  });

  it('removes a server', async () => {
    useContextStore.setState((s) => ({
      context: s.context
        ? {
            ...s.context,
            mcpServers: [{ id: 'm1', name: 'X', url: 'http://x', status: 'online' }],
          }
        : null,
    }));
    const user = userEvent.setup();
    render(<><DialogHost /><McpServersSection /></>);
    await user.click(screen.getByRole('button', { name: /remove x/i }));
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.mcpServers).toHaveLength(0);
  });

  it('shows Connect button when server is offline', () => {
    useContextStore.setState({
      context: {
        systemInstruction: '', skills: [], tools: [],
        mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
      },
    });
    render(<McpServersSection />);
    expect(screen.getByRole('button', { name: /connect mock/i })).toBeInTheDocument();
  });

  it('clicking Connect triggers useMcpStore.connect', async () => {
    useContextStore.setState({
      context: {
        systemInstruction: '', skills: [], tools: [],
        mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
      },
    });
    const spy = vi.spyOn(useMcpStore.getState(), 'connect').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<McpServersSection />);
    await user.click(screen.getByRole('button', { name: /connect mock/i }));
    expect(spy).toHaveBeenCalledWith('M1');
  });

  it('shows ↻ Refresh button when state=online', () => {
    useContextStore.setState({
      context: {
        systemInstruction: '', skills: [], tools: [],
        mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
      },
    });
    useMcpStore.setState({
      liveTools: [], connectStates: { M1: 'online' }, errors: {}, inFlightCalls: {}, reconnectInfo: {},
    });
    render(<McpServersSection />);
    expect(screen.getByRole('button', { name: /refresh mock/i })).toBeInTheDocument();
  });

  it('shows reconnecting badge when state=reconnecting', () => {
    useContextStore.setState({
      context: {
        systemInstruction: '', skills: [], tools: [],
        mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
      },
    });
    useMcpStore.setState({
      liveTools: [], connectStates: { M1: 'reconnecting' }, errors: {}, inFlightCalls: {},
      reconnectInfo: { M1: { attempt: 2, max: 5 } },
    });
    render(<McpServersSection />);
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
    expect(screen.getByText(/2\/5/)).toBeInTheDocument();
  });

  it('Refresh button triggers refreshServer', async () => {
    useContextStore.setState({
      context: {
        systemInstruction: '', skills: [], tools: [],
        mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
      },
    });
    useMcpStore.setState({
      liveTools: [], connectStates: { M1: 'online' }, errors: {}, inFlightCalls: {}, reconnectInfo: {},
    });
    const refreshSpy = vi.fn().mockResolvedValue(undefined);
    useMcpStore.setState({ refreshServer: refreshSpy });
    const user = userEvent.setup();
    render(<McpServersSection />);
    await user.click(screen.getByRole('button', { name: /refresh mock/i }));
    expect(refreshSpy).toHaveBeenCalledWith('M1');
  });

  it('does not render servers whose id starts with "builtin:"', () => {
    useContextStore.setState((s) => ({
      context: s.context
        ? {
            ...s.context,
            mcpServers: [
              { id: 'builtin:filesystem', name: 'Filesystem', transport: 'stdio', status: 'offline' },
              { id: 'user-server-1', name: 'My MCP', url: 'http://my-mcp', status: 'offline' },
            ],
          }
        : null,
    }));
    render(<McpServersSection />);
    expect(screen.queryByText('Filesystem')).toBeNull();
    expect(screen.getByText('My MCP')).toBeInTheDocument();
  });

  it('when online, lists live tools and a Disconnect button', () => {
    useContextStore.setState({
      context: {
        systemInstruction: '', skills: [], tools: [],
        mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
      },
    });
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }],
      connectStates: { M1: 'online' },
      errors: {},
    });
    render(<McpServersSection />);
    expect(screen.getByText('mock.echo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect mock/i })).toBeInTheDocument();
  });
});
