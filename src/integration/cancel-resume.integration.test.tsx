import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { useChatStore } from '@/src/stores/chat.store';

beforeEach(() => {
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
  server.resetHandlers();
});

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseResponse(frames: string[]) {
  const body = frames.join('');
  return new HttpResponse(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('cancel + resume integration', () => {
  it('user sends → stops mid-stream → Riprendi continues in a new model message', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        sseResponse([
          sseFrame('text', { chunk: 'half ' }),
          sseFrame('done', { model: 'fake', interrupted: true, reasoningSteps: [] }),
        ]),
      ),
      http.post('http://localhost/api/ai/dispatch/resume', () =>
        sseResponse([
          sseFrame('text', { chunk: 'rest of the answer' }),
          sseFrame('done', { model: 'fake', interrupted: false, reasoningSteps: [] }),
        ]),
      ),
    );

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(useSessionsStore.getState().activeSessionId).toBeTruthy());

    const input = screen.getByPlaceholderText(/scrivi un messaggio/i);
    await user.type(input, 'ciao');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/Interrotto/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /riprendi la risposta/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /riprendi la risposta/i }));

    await waitFor(() => {
      expect(screen.getByText(/rest of the answer/)).toBeInTheDocument();
    });

    // The original interrupted message still shows.
    expect(screen.getByText(/half/)).toBeInTheDocument();
  });
});
