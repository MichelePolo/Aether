import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { useChatStore } from '@/src/stores/chat.store';
import { useKeyVaultStore } from '@/src/stores/keyVault.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  useChatStore.getState()._reset();
  useKeyVaultStore.getState()._reset();
  useProviderAuthStore.getState()._reset();
  useBuiltinMcpStore.getState()._reset();
  localStorage.clear();
});

afterEach(() => {
  server.resetHandlers();
});

describe('builtin MCP toggle round-trip', () => {
  it('clicking Toggle Filesystem twice flips enabled true → false via PUT', async () => {
    let capturedBody: { enabled?: boolean; fsRoot?: string | null } | null = null;

    server.use(
      http.put('http://localhost/api/mcp/builtin/filesystem', async ({ request }) => {
        const body = (await request.json()) as { enabled?: boolean; fsRoot?: string | null };
        capturedBody = body;
        return HttpResponse.json({
          state: {
            transport: 'filesystem',
            enabled: body.enabled ?? false,
            fsRoot: null,
          },
        });
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    // Wait for the store to be populated from GET /api/mcp/builtin
    await waitFor(() => expect(useBuiltinMcpStore.getState().builtins.length).toBe(2));

    // First click: enable filesystem (disabled → enabled)
    const toggleBtn = screen.getByLabelText(/toggle filesystem/i);
    await user.click(toggleBtn);

    await waitFor(() => {
      expect(capturedBody?.enabled).toBe(true);
    });
    await waitFor(() => {
      const row = useBuiltinMcpStore.getState().builtins.find((b) => b.transport === 'filesystem');
      expect(row?.enabled).toBe(true);
    });

    // Second click: disable filesystem (enabled → disabled)
    await user.click(toggleBtn);

    await waitFor(() => {
      expect(capturedBody?.enabled).toBe(false);
    });
    await waitFor(() => {
      const row = useBuiltinMcpStore.getState().builtins.find((b) => b.transport === 'filesystem');
      expect(row?.enabled).toBe(false);
    });
  });
});
