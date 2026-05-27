// src/integration/fork.integration.test.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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
  localStorage.clear();
});

afterEach(() => {
  server.resetHandlers();
});

describe('fork flow integration', () => {
  it('right-click user bubble → Branch from here → sets active session to FORKED', async () => {
    let capturedBody: { fromMessageId?: string } = {};

    server.use(
      http.post('http://localhost/api/sessions/:id/fork', async ({ request }) => {
        capturedBody = (await request.json()) as { fromMessageId?: string };
        return HttpResponse.json(
          {
            meta: {
              id: 'FORKED',
              title: 'forked',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    // Wait for sessions to hydrate
    await waitFor(() => expect(useSessionsStore.getState().hydrated).toBe(true));

    // Seed two messages — one user, one model
    useChatStore.setState({
      messages: [
        { id: 'U1', role: 'user', text: 'Hello', timestamp: 1000 },
        { id: 'M1', role: 'model', text: 'Hi there', timestamp: 2000 },
      ],
    });

    // Wait for the user bubble to appear in the DOM
    await waitFor(() => {
      // Find the user bubble by looking for divs that contain 'Hello' text
      const allDivs = document.querySelectorAll('div');
      const userBubble = Array.from(allDivs).find(
        (el) => el.textContent === 'Hello' && el.tagName === 'SPAN',
      );
      return userBubble !== null;
    });

    // Find the user bubble container that has the onContextMenu handler
    // The MessageBubble renders a div with onContextMenu wrapping the content
    let userBubble: Element | null = null;
    await waitFor(() => {
      const spans = document.querySelectorAll('span');
      const helloSpan = Array.from(spans).find((s) => s.textContent === 'Hello');
      expect(helloSpan).toBeTruthy();
      // Walk up to find the div with onContextMenu (the styled bubble div)
      userBubble = helloSpan!.closest('div[class*="rounded-2xl"]');
      expect(userBubble).toBeTruthy();
    });

    // Dispatch contextmenu event on the bubble
    userBubble!.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 200,
      }),
    );

    // Wait for the context menu to appear in the UI store
    await waitFor(() => {
      expect(useUiStore.getState().messageContextMenu).not.toBeNull();
    });

    // Click "Branch from here"
    const branchButton = await waitFor(() => {
      const buttons = document.querySelectorAll('button');
      const btn = Array.from(buttons).find((b) => b.textContent === 'Branch from here');
      expect(btn).toBeTruthy();
      return btn!;
    });

    await user.click(branchButton);

    // Assert captured body has fromMessageId: 'U1'
    await waitFor(() => {
      expect(capturedBody.fromMessageId).toBe('U1');
    });

    // Assert the active session switched to 'FORKED'
    await waitFor(() => {
      expect(useSessionsStore.getState().activeSessionId).toBe('FORKED');
    });
  });
});
