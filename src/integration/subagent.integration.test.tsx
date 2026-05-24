// src/integration/subagent.integration.test.tsx
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

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  localStorage.clear();
});

describe('subagent integration', () => {
  it('FE sends the original @name message to the backend', async () => {
    server.use(
      http.get('http://localhost/api/subagents', () =>
        HttpResponse.json({
          subAgents: [{ id: 's1', name: 'designer', createdAt: 1, updatedAt: 1 }],
        }),
      ),
    );

    let capturedBody: unknown = null;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        capturedBody = await request.json();
        return new HttpResponse(
          'event: done\ndata: {"model":"fake","interrupted":false,"reasoningSteps":[]}\n\n',
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        );
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    // Wait for sessions and subagents to hydrate (auto-creates a session when list is empty)
    await waitFor(() =>
      expect(useSessionsStore.getState().activeSessionId).not.toBeNull(),
    );
    await waitFor(() =>
      expect(useSubAgentsStore.getState().hydrated).toBe(true),
    );

    const ta = screen.getByPlaceholderText(/type a message/i);
    await user.click(ta);
    // Type "@designer" — popover opens; then type " ciao" — space closes the popover
    await user.type(ta, '@designer ciao');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect((capturedBody as { message?: string })?.message).toBe('@designer ciao');
    });
  });
});
