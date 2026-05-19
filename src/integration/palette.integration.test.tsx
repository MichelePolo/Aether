// src/integration/palette.integration.test.tsx
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
import { __setIsMacForTests } from '@/src/hooks/useKeyboardShortcut';

beforeEach(() => {
  // Force Mac modifier so metaKey is used (jsdom navigator.platform is not "mac")
  __setIsMacForTests(true);
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  localStorage.clear();
});

afterEach(() => {
  __setIsMacForTests(null);
});

describe('palette integration', () => {
  it('⌘K opens palette; running "New session" hits the API', async () => {
    let createCalled = false;
    server.use(
      http.post('http://localhost/api/sessions', () => {
        createCalled = true;
        return HttpResponse.json(
          { id: 'sX', title: 'untitled', createdAt: 1, updatedAt: 1 },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    // Wait for init to settle (App mounts and fires init actions)
    await waitFor(() => expect(useSessionsStore.getState().hydrated).toBe(true));

    // Reset the flag — init() may also POST /api/sessions if list is empty
    createCalled = false;

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }),
      );
    });

    expect(await screen.findByPlaceholderText(/type a command/i)).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/type a command/i);
    await user.type(input, 'new session');

    // Wait for cmdk filter to settle
    await waitFor(() => {
      expect(screen.queryByText(/no matching commands/i)).not.toBeInTheDocument();
    });

    await user.keyboard('{Enter}');

    await waitFor(() => expect(createCalled).toBe(true));
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('⌘B toggles sidebar visibility', async () => {
    render(<App />);
    // Wait for init to settle
    await waitFor(() => expect(useSessionsStore.getState().hydrated).toBe(true));

    expect(useUiStore.getState().sidebarOpen).toBe(true);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', metaKey: true, cancelable: true }),
      );
    });
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });
});
