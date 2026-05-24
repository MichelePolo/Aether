import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { emitToolCallRequest } from '@/src/hooks/useToolCallDecisions';
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
import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store';
import { useBreakpointsStore } from '@/src/stores/breakpoints.store';

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
  useBuiltinMcpStore.getState()._reset();
  useBreakpointsStore.getState()._reset();
});

describe('approval gate integration', () => {
  it('emit tool_call_request → ApprovalGate opens → Approve closes it', async () => {
    render(<App />);
    act(() => emitToolCallRequest({ callId: 'c-int-1', qualifiedName: 'fs.write_file', args: { path: '/tmp/x' } }));

    await waitFor(() => expect(screen.getByText('fs.write_file')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(useUiStore.getState().approvalGateState).toBeNull());
  });

  it('Approve sends the real callId from the server event to /api/mcp/decision', async () => {
    let decisionBody: { callId?: string; action?: string } | null = null;
    server.use(
      http.post('http://localhost/api/mcp/decision', async ({ request }) => {
        decisionBody = (await request.json()) as { callId?: string; action?: string };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<App />);
    // The server emits tool_call_request with `callId` (not `id`).
    act(() => emitToolCallRequest({ callId: 'c-real-9', qualifiedName: 'fs.write_file', args: {} }));
    await waitFor(() => expect(screen.getByText('fs.write_file')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(decisionBody).toEqual({ callId: 'c-real-9', action: 'approve' }));
  });

  it('sticky approval skips the gate next time', async () => {
    render(<App />);
    useChatStore.getState().addStickyApproval('fs.write_file');
    act(() => emitToolCallRequest({ callId: 'c-int-2', qualifiedName: 'fs.write_file', args: {} }));
    await Promise.resolve();
    await Promise.resolve();
    expect(useUiStore.getState().approvalGateState).toBeNull();
  });
});
