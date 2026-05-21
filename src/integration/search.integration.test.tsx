import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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
import { __setIsMacForTests } from '@/src/hooks/useKeyboardShortcut';

beforeEach(() => {
  __setIsMacForTests(true);
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  useChatStore.getState()._reset();
  localStorage.clear();
});

afterEach(() => {
  __setIsMacForTests(null);
  server.resetHandlers();
});

describe('search integration', () => {
  it('Cmd+K → Search history… → type → click result → active session changes', async () => {
    server.use(
      http.get('http://localhost/api/search', () =>
        HttpResponse.json({
          results: [
            {
              sessionId: 'S-target',
              title: 'Target session',
              updatedAt: 100,
              hits: [{ messageId: 'm1', role: 'user', snippet: 'a «M»hyperloop«/M» mention' }],
            },
            {
              sessionId: 'S-other',
              title: 'Other session',
              updatedAt: 50,
              hits: [{ messageId: 'm2', role: 'model', snippet: 'also has «M»hyperloop«/M»' }],
            },
          ],
        }),
      ),
    );

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(useSessionsStore.getState().hydrated).toBe(true));

    // Open the palette via the existing global keyboard shortcut.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }),
      );
    });
    await waitFor(() => {
      expect(useUiStore.getState().paletteOpen).toBe(true);
    });

    // Click "Search history…".
    await user.click(screen.getByText('Search history…'));
    await waitFor(() => {
      expect(useUiStore.getState().paletteMode).toBe('search');
    });

    // Type the query.
    await user.type(screen.getByPlaceholderText(/search messages/i), 'hyperloop');

    // Both sessions render.
    await waitFor(() => {
      expect(screen.getByText('Target session')).toBeInTheDocument();
      expect(screen.getByText('Other session')).toBeInTheDocument();
    });

    // Click the first result.
    await user.click(screen.getByText('Target session'));

    // Palette closed and active session updated.
    await waitFor(() => {
      expect(useUiStore.getState().paletteOpen).toBe(false);
      expect(useSessionsStore.getState().activeSessionId).toBe('S-target');
    });
  });
});
