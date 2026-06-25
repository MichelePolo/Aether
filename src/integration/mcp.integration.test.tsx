// src/integration/mcp.integration.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';

beforeEach(() => {
  useMcpStore.getState()._reset();
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  localStorage.clear();
  // Pre-seed sidebarGroups so initFromStorage opens the Tools group (McpServersSection)
  localStorage.setItem('aether.sidebarGroups', JSON.stringify({ sessions: true, systemProtocol: false, skillsAgents: true, tools: true, workspaces: false, providers: true }));
});

describe('mcp integration', () => {
  it('user clicks Connect → sees live tool', async () => {
    server.use(
      http.get('http://localhost/api/context', () =>
        HttpResponse.json({
          systemInstruction: '',
          skills: [],
          tools: [],
          mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
        }),
      ),
      http.post('http://localhost/api/mcp/M1/connect', () =>
        HttpResponse.json({ state: 'online', tools: [{ name: 'echo', inputSchema: {} }] }),
      ),
      http.get('http://localhost/api/mcp/tools', () =>
        HttpResponse.json({
          tools: [{
            qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock',
            tool: { name: 'echo', inputSchema: {} }, autoApprove: true,
          }],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<App />);

    // Wait for context init to complete
    await waitFor(() => expect(useContextStore.getState().context?.mcpServers).toHaveLength(1));

    // Click Connect on the mock server
    await user.click(screen.getByRole('button', { name: /connect mock/i }));

    // The sidebar should now show the live tool
    await waitFor(() => expect(screen.getByText('mock.echo')).toBeInTheDocument());
  });
});
