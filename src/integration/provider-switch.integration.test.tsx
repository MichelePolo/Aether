// src/integration/provider-switch.integration.test.tsx
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

describe('provider switch integration', () => {
  it('selecting a provider PATCHes the active session AND updates the default in localStorage', async () => {
    let patchedBody: unknown = null;
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [
            { name: 'fake:default', transport: 'fake', model: 'default',
              capabilities: { thinking: true, toolCalling: true }, displayName: 'Fake' },
            { name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
              capabilities: { thinking: false, toolCalling: true }, displayName: 'Ollama / llama3' },
          ],
        }),
      ),
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'fake:default' }),
      ),
      http.patch('http://localhost/api/sessions/:id', async ({ request, params }) => {
        patchedBody = await request.json();
        return HttpResponse.json({
          id: params.id, title: 't', createdAt: 0, updatedAt: 1,
          providerName: (patchedBody as { providerName?: string })?.providerName,
        });
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(useProvidersStore.getState().hydrated).toBe(true));
    await waitFor(() => expect(useSessionsStore.getState().activeSessionId).toBeTruthy());

    const select = screen.getByRole('combobox', { name: /active provider/i });
    await user.selectOptions(select, 'ollama:llama3');

    await waitFor(() => {
      expect((patchedBody as { providerName?: string })?.providerName).toBe('ollama:llama3');
    });
    expect(localStorage.getItem('aether.defaultProvider')).toBe('ollama:llama3');
  });

  it('Anthropic entries appear in the selector when the server publishes them', async () => {
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [
            {
              name: 'fake:default',
              transport: 'fake',
              model: 'default',
              capabilities: { thinking: true, toolCalling: true },
              displayName: 'Fake (default)',
            },
            {
              name: 'anthropic:claude-sonnet-4-6',
              transport: 'anthropic',
              model: 'claude-sonnet-4-6',
              capabilities: { thinking: true, toolCalling: true },
              displayName: 'Anthropic / claude-sonnet-4-6',
            },
            {
              name: 'anthropic:claude-opus-4-7',
              transport: 'anthropic',
              model: 'claude-opus-4-7',
              capabilities: { thinking: true, toolCalling: true },
              displayName: 'Anthropic / claude-opus-4-7',
            },
          ],
        }),
      ),
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'fake:default' }),
      ),
      http.patch('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({ id: '1', title: 't', createdAt: 0, updatedAt: 1 }),
      ),
    );

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(useProvidersStore.getState().hydrated).toBe(true));
    await waitFor(() => expect(useSessionsStore.getState().activeSessionId).toBeTruthy());

    const selector = screen.getByRole('combobox', { name: /active provider/i });
    expect(
      await screen.findByRole('option', { name: /anthropic.*claude-sonnet-4-6/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('option', { name: /anthropic.*claude-opus-4-7/i }),
    ).toBeInTheDocument();

    await user.selectOptions(selector, 'anthropic:claude-sonnet-4-6');
    expect(selector).toHaveValue('anthropic:claude-sonnet-4-6');
  });
});
