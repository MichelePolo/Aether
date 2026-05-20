// src/integration/subagent-edit.integration.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
});

describe('subagent edit integration', () => {
  it('row click opens modal; rename PATCHes; add skill PATCHes', async () => {
    server.use(
      http.get('http://localhost/api/subagents', () =>
        HttpResponse.json({
          subAgents: [{ id: 'SA1', name: 'designer', createdAt: 1, updatedAt: 1 }],
        }),
      ),
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({
          id: 'SA1',
          name: 'designer',
          systemInstruction: '',
          skills: [],
          tools: [],
          createdAt: 1,
          updatedAt: 1,
        }),
      ),
    );

    let lastPatch: unknown = null;
    server.use(
      http.put('http://localhost/api/subagents/SA1', async ({ request }) => {
        lastPatch = await request.json();
        return HttpResponse.json({ id: 'SA1', name: 'designer', createdAt: 1, updatedAt: 2 });
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    // Wait for sidebar to populate
    await waitFor(() => expect(useSubAgentsStore.getState().list).toHaveLength(1));

    // Click the row in the sidebar
    await user.click(screen.getByText('designer'));

    // Modal opens and fetches the record (there are now 2 elements with text 'designer'
    // — the sidebar row and the modal title)
    await waitFor(() => expect(screen.getAllByText('designer').length).toBeGreaterThan(1));

    // Rename — scope to the Edit Sub-agent dialog to avoid matching session rename buttons
    const editDialog = screen.getByRole('dialog', { name: /edit sub-agent/i });
    await user.click(within(editDialog).getByRole('button', { name: /rename/i }));
    const nameInput = await screen.findByLabelText(/^name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'sculptor');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => {
      expect((lastPatch as { name?: string })?.name).toBe('sculptor');
    });

    // Add skill — scope to the Edit Sub-agent dialog
    const editDialog2 = screen.getByRole('dialog', { name: /edit sub-agent/i });
    await user.click(within(editDialog2).getByRole('button', { name: /add skill/i }));
    const skillInput = await screen.findByLabelText(/skill name/i);
    await user.type(skillInput, 'clay');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => {
      expect((lastPatch as { skills?: string[] })?.skills).toEqual(['clay']);
    });
  });
});
