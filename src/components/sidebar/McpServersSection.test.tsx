import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpServersSection } from './McpServersSection';
import { useContextStore } from '@/src/stores/context.store';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { _resetDialogStore } from '@/src/hooks/useDialog';

beforeEach(() => {
  _resetDialogStore();
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
});
