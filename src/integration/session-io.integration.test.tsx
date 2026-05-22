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

describe('session io integration', () => {
  it('Cmd+K → Import session… → select file → new session is active', async () => {
    server.use(
      http.post('http://localhost/api/sessions/import', () =>
        HttpResponse.json(
          { id: 'imp-1', title: 'My Imported Session', createdAt: 1, updatedAt: 2 },
          { status: 201 },
        ),
      ),
    );

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useSessionsStore.getState().hydrated).toBe(true));

    // Open palette via Cmd+K.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }),
      );
    });
    await waitFor(() => expect(useUiStore.getState().paletteOpen).toBe(true));

    // Click "Import session…".
    await user.click(screen.getByText('Import session…'));

    // Find the hidden input (mounted by App via HiddenImportInput).
    const input = document.querySelector(
      'input[type="file"][accept="application/json"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();

    // Simulate a file selection.
    const envelope = {
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: { title: 'My Imported Session', createdAt: 0, messages: [] },
    };
    const file = new File([JSON.stringify(envelope)], 'session.json', {
      type: 'application/json',
    });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await waitFor(() => {
      expect(useSessionsStore.getState().activeSessionId).toBe('imp-1');
    });
    expect(useSessionsStore.getState().sessions[0].title).toBe('My Imported Session');
  });
});
