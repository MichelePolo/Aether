import { emitToolCallRequest, type ToolCallRequestEvent } from '@/src/hooks/useToolCallDecisions';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useUiStore } from '@/src/stores/ui.store';
import type { McpConnectionState } from '@/src/types/mcp.types';

/** Each stream owns its calls so closing one run cannot dismiss another run's gate. */
export function createToolEventConsumer() {
  const calls = new Map<string, AbortController>();
  const clear = (id: string) => {
    calls.get(id)?.abort();
    calls.delete(id);
    useMcpStore.getState().clearInFlightCall(id);
    useUiStore.getState().closeApprovalGate(id);
  };
  return {
    consume(name: string, data: unknown) {
      const p = data as { id?: string; callId?: string; qualifiedName: string; args: Record<string, unknown>; note: string };
      const id = p.callId ?? p.id;
      if (name === 'tool_call_request' && id) {
        if (!calls.has(id)) calls.set(id, new AbortController());
        emitToolCallRequest({ ...p, callId: id, signal: calls.get(id)!.signal } as ToolCallRequestEvent);
      } else if (name === 'tool_call_started' && id) {
        if (!calls.has(id)) calls.set(id, new AbortController());
        useUiStore.getState().closeApprovalGate(id);
        useMcpStore.getState().registerInFlightCall({ callId: id, qualifiedName: p.qualifiedName, args: p.args });
      } else if (name === 'tool_call_progress' && id) {
        useMcpStore.getState().updateInFlightProgress(id, p.note);
      } else if (name === 'tool_call_result' && id) {
        clear(id);
      } else if (name === 'mcp:state_change') {
        const d = data as { id: string; state: McpConnectionState; error?: string; reconnectAttempt?: number; reconnectMaxAttempts?: number };
        useMcpStore.getState().applyServerStateEvent(d.id, d.state, d.error, d.reconnectAttempt, d.reconnectMaxAttempts);
      }
    },
    close() { for (const id of calls.keys()) clear(id); },
  };
}
