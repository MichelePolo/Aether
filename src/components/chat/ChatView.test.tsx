import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { ChatView } from './ChatView';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';

beforeEach(() => {
  useChatStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useUiStore.getState()._reset();
  useSessionsStore.setState({
    sessions: [{ id: 'S1', title: '', createdAt: 0, updatedAt: 0 }],
    activeSessionId: 'S1',
    hydrated: true,
  });
});

function sse(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

describe('ChatView', () => {
  it('happy path: send a message and receive streamed reply', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sse(
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: text\ndata: {"chunk":" Aether"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    render(<ChatView />);
    await userEvent.type(screen.getByRole('textbox'), 'hi{Enter}');
    await waitFor(() => {
      expect(screen.getByText(/Hello Aether/)).toBeInTheDocument();
    });
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('Retry resends the last user message', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sse('event: error\ndata: {"message":"Network","retryable":true}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    render(<ChatView />);
    await userEvent.type(screen.getByRole('textbox'), 'first{Enter}');
    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sse(
            'event: text\ndata: {"chunk":"OK"}\n\n',
            'event: done\ndata: {"model":"f","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    await userEvent.click(retryBtn);
    await waitFor(() => {
      expect(screen.getByText('OK')).toBeInTheDocument();
    });
  });

  it('shows fallback message when no active session', () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    render(<ChatView />);
    expect(screen.getByText(/No active session/i)).toBeInTheDocument();
  });

  it('event:thinking auto-opens reasoning drawer', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sse(
            'event: thinking\ndata: {"chunk":"pondering"}\n\n',
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false,"reasoningSteps":[]}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
    render(<ChatView />);
    await userEvent.type(screen.getByRole('textbox'), 'hi{Enter}');
    await waitFor(() => {
      expect(useUiStore.getState().reasoningDrawerOpen).toBe(true);
    });
  });
});
