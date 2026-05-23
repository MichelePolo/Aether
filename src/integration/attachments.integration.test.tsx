// src/integration/attachments.integration.test.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

describe('attachment flow integration', () => {
  it('drop image → send → attachment in dispatch body → queue cleared on done', async () => {
    let receivedBody: Record<string, unknown> | null = null;

    server.use(
      // Force a vision-capable provider
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [
            {
              name: 'fake:vision',
              transport: 'fake',
              model: 'vision',
              capabilities: { thinking: false, toolCalling: false, vision: true },
              displayName: 'Fake Vision',
            },
          ],
        }),
      ),
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'fake:vision' }),
      ),
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        receivedBody = (await request.json()) as Record<string, unknown>;
        return sseResponse([
          sseFrame('text', { chunk: 'I see the image' }),
          sseFrame('done', { model: 'fake:vision', interrupted: false, reasoningSteps: [] }),
        ]);
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(useSessionsStore.getState().hydrated).toBe(true));

    // Build a file to drop
    const file = new File(['PNG-BYTES'], 'p.png', { type: 'image/png' });

    // Find the drop zone — AttachmentDropZone renders with data-drag-active attribute
    const dropZone = document.querySelector('[data-drag-active]') as HTMLElement;
    expect(dropZone).toBeTruthy();

    // Simulate dropping the file onto the drop zone
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    // Confirm the file was queued
    await waitFor(() =>
      expect(useChatStore.getState().queuedAttachments).toHaveLength(1),
    );

    // Type a message and submit
    const input = screen.getByPlaceholderText(/scrivi un messaggio/i);
    await user.type(input, 'see this');
    await user.keyboard('{Enter}');

    // Confirm the dispatch body contained the attachment
    await waitFor(() => {
      const attachments = receivedBody?.attachments as Array<{
        name: string;
        mime: string;
        size: number;
        contentBase64: string;
      }> | undefined;
      expect(attachments).toBeDefined();
      expect(attachments).toHaveLength(1);
      expect(attachments?.[0]?.name).toBe('p.png');
      expect(attachments?.[0]?.mime).toBe('image/png');
      expect(attachments?.[0]?.contentBase64).toBeTruthy();
    });

    // Confirm the queue was cleared after the done event
    await waitFor(() =>
      expect(useChatStore.getState().queuedAttachments).toHaveLength(0),
    );
  });
});
