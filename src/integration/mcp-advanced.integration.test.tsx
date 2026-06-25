import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useProvidersStore } from '@/src/stores/providers.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  localStorage.clear();
  // Pre-seed sidebarGroups so initFromStorage opens the Tools group (McpServersSection)
  localStorage.setItem('aether.sidebarGroups', JSON.stringify({ sessions: true, systemProtocol: false, skillsAgents: true, tools: true, workspaces: false, providers: true }));
});

describe('mcp advanced integration', () => {
  it('Cancel button on ToolCallBanner POSTs cancelCall with the right id', async () => {
    let posted: unknown = null;
    server.use(
      http.post('http://localhost/api/mcp/cancel-call', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    useMcpStore.getState().registerInFlightCall({
      callId: 'CALL-1',
      qualifiedName: 'mock.slow',
      args: { sleep: 5 },
    });
    await waitFor(() => expect(screen.getByText('mock.slow')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /cancel mock\.slow/i }));
    await waitFor(() => expect((posted as { callId?: string })?.callId).toBe('CALL-1'));
  });

  it('updates progressNote on banner as tool_call_progress arrives', async () => {
    render(<App />);
    useMcpStore.getState().registerInFlightCall({
      callId: 'CALL-2',
      qualifiedName: 'mock.slow',
      args: {},
    });
    useMcpStore.getState().updateInFlightProgress('CALL-2', '1/2 — step one');
    await waitFor(() => expect(screen.getByText(/1\/2 — step one/)).toBeInTheDocument());
    useMcpStore.getState().updateInFlightProgress('CALL-2', '2/2 — step two');
    await waitFor(() => expect(screen.getByText(/2\/2 — step two/)).toBeInTheDocument());
  });

  it('clears the banner when tool_call_result clears the in-flight entry', async () => {
    render(<App />);
    useMcpStore.getState().registerInFlightCall({
      callId: 'CALL-3',
      qualifiedName: 'mock.echo',
      args: {},
    });
    await waitFor(() => expect(screen.getByText('mock.echo')).toBeInTheDocument());
    useMcpStore.getState().clearInFlightCall('CALL-3');
    await waitFor(() => expect(screen.queryByText('mock.echo')).not.toBeInTheDocument());
  });

  it('Refresh button on online server triggers refreshServer + updates liveTools', async () => {
    server.use(
      http.get('http://localhost/api/context', () =>
        HttpResponse.json({
          systemInstruction: '',
          skills: [],
          tools: [],
          mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
        }),
      ),
      http.post('http://localhost/api/mcp/M1/refresh-tools', () =>
        HttpResponse.json({
          tools: [
            {
              qualifiedName: 'mock.current_time',
              serverId: 'M1',
              serverName: 'mock',
              tool: { name: 'current_time', inputSchema: {} },
              autoApprove: true,
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useContextStore.getState().context?.mcpServers).toHaveLength(1));
    useMcpStore.setState({
      liveTools: [],
      connectStates: { M1: 'online' },
      errors: {},
      inFlightCalls: {},
      reconnectInfo: {},
    });
    await user.click(await screen.findByRole('button', { name: /refresh mock/i }));
    await waitFor(() => {
      expect(useMcpStore.getState().liveTools.map((t) => t.tool.name)).toEqual(['current_time']);
    });
  });

  it('shows reconnecting (N/M) badge when state transitions to reconnecting', async () => {
    server.use(
      http.get('http://localhost/api/context', () =>
        HttpResponse.json({
          systemInstruction: '',
          skills: [],
          tools: [],
          mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
        }),
      ),
    );
    render(<App />);
    await waitFor(() => expect(useContextStore.getState().context?.mcpServers).toHaveLength(1));
    useMcpStore.getState().applyServerStateEvent('M1', 'reconnecting', undefined, 3, 5);
    await waitFor(() => {
      expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
      expect(screen.getByText(/3\/5/)).toBeInTheDocument();
    });
  });
});
