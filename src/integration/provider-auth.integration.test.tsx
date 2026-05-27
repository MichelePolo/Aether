// src/integration/provider-auth.integration.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  useProviderAuthStore.getState()._reset();
  localStorage.clear();
});

describe('provider-auth integration', () => {
  it('App mounts and renders 3 keyed provider auth rows plus an Ollama status row', async () => {
    server.use(
      http.get('http://localhost/api/providers/auth-status', () =>
        HttpResponse.json({
          checkedAt: Date.now(),
          statuses: [
            { transport: 'anthropic', state: 'ok', reason: '' },
            { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
            { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
          ],
          ollama: [
            { id: 'local', label: 'local', fixed: true, state: 'ok', reason: '' },
          ],
        }),
      ),
    );

    render(<App />);

    await waitFor(() => {
      const rows = screen.getAllByTestId('provider-auth-row');
      expect(rows).toHaveLength(3);
    });

    const rows = screen.getAllByTestId('provider-auth-row');
    expect(rows[0]).toHaveTextContent('Anthropic');
    expect(rows[1]).toHaveTextContent('OpenAI');
    expect(rows[2]).toHaveTextContent('Gemini');

    // Ollama renders as a dedicated sub-block with ollama-status-row testids
    await waitFor(() => {
      expect(screen.getAllByTestId('ollama-status-row')).toHaveLength(1);
    });
    expect(screen.getByTestId('ollama-status-row')).toHaveTextContent('local');
  });
});
