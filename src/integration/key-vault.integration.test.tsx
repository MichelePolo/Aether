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
import { useKeyVaultStore } from '@/src/stores/keyVault.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
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
  useKeyVaultStore.getState()._reset();
  useProviderAuthStore.getState()._reset();
  localStorage.clear();
});

afterEach(() => {
  __setIsMacForTests(null);
  server.resetHandlers();
});

describe('key vault integration', () => {
  it('palette → Configure API keys… → type + save OpenAI key → store updated', async () => {
    let capturedKey: string | null = null;

    server.use(
      http.put('http://localhost/api/providers/keys/openai', async ({ request }) => {
        const body = (await request.json()) as { key: string };
        capturedKey = body.key;
        return HttpResponse.json({
          row: {
            transport: 'openai',
            hasKey: true,
            masked: 'sk-…2345',
            updatedAt: 1,
          },
          status: {
            transport: 'openai',
            state: 'ok',
            reason: 'api key set',
          },
        });
      }),
    );

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useSessionsStore.getState().hydrated).toBe(true));

    // Open palette via Cmd+K
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }),
      );
    });
    await waitFor(() => expect(useUiStore.getState().paletteOpen).toBe(true));

    // Click "Configure API keys…"
    await user.click(screen.getByText('Configure API keys…'));

    // Wait for modal to open and 5 rows to be rendered
    await waitFor(() => expect(useUiStore.getState().keyVaultOpen).toBe(true));
    await waitFor(() => {
      const rows = screen.getAllByTestId('key-vault-row');
      expect(rows).toHaveLength(5);
    });

    // Type key into OpenAI input
    const openAiInput = screen.getByLabelText('OpenAI key');
    await user.type(openAiInput, 'sk-int-test-12345');

    // Click "Save openai" button
    const saveButton = screen.getByRole('button', { name: 'Save openai' });
    await user.click(saveButton);

    // Assert the PUT body contained the right key
    await waitFor(() => {
      expect(capturedKey).toBe('sk-int-test-12345');
    });

    // Assert the vault store was updated
    await waitFor(() => {
      const row = useKeyVaultStore.getState().vault.find((r) => r.transport === 'openai');
      expect(row?.hasKey).toBe(true);
      expect(row?.masked).toBe('sk-…2345');
    });
  });
});
