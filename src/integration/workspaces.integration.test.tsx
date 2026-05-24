import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
import { useBreakpointsStore } from '@/src/stores/breakpoints.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';

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
  useBreakpointsStore.getState()._reset();
  useWorkspacesStore.getState()._reset();
});

describe('workspaces integration', () => {
  it('add workspace → browser modal → create → row appears in sidebar', async () => {
    server.use(
      http.get('http://localhost/api/workspaces/browse', () =>
        HttpResponse.json({ entries: [{ name: 'project-a', isDir: true }] }),
      ),
      http.post('http://localhost/api/workspaces', async ({ request }) => {
        const body = (await request.json()) as { name: string; rootPath: string };
        return HttpResponse.json(
          { id: 'w-int-1', name: body.name, rootPath: body.rootPath, addedAt: Date.now() },
          { status: 201 },
        );
      }),
    );

    render(<App />);

    // Open the modal via the sidebar button
    await waitFor(() => screen.getByRole('button', { name: /add workspace/i }));
    fireEvent.click(screen.getByRole('button', { name: /add workspace/i }));

    // Descend into "project-a"
    await waitFor(() => screen.getByText(/project-a/));
    fireEvent.click(screen.getByText(/project-a/));

    // Wait until the "Add this folder" button is enabled (currentPath populated).
    const addButton = await screen.findByRole('button', { name: 'Add this folder' });
    await waitFor(() => expect(addButton).not.toBeDisabled());
    fireEvent.click(addButton);

    // Modal closes; new workspace row appears in sidebar.
    await waitFor(() =>
      expect(useUiStore.getState().workspaceBrowserOpen).toBe(false),
    );
    await waitFor(() =>
      expect(useWorkspacesStore.getState().workspaces.length).toBe(1),
    );
  });
});
