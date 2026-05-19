import { useEffect } from 'react';
import { useDialog } from './useDialog';
import { useMcpStore } from '@/src/stores/mcp.store';
import { mcpApi } from '@/src/lib/api/mcp.api';

export interface ToolCallRequestEvent {
  id: string;
  qualifiedName: string;
  args: Record<string, unknown>;
}

type Listener = (ev: ToolCallRequestEvent) => void;
const listeners = new Set<Listener>();

export function emitToolCallRequest(ev: ToolCallRequestEvent): void {
  for (const l of listeners) l(ev);
}

export function useToolCallDecisions(): void {
  const dialog = useDialog();

  useEffect(() => {
    const handler: Listener = (ev) => {
      const tool = useMcpStore.getState().liveTools.find((t) => t.qualifiedName === ev.qualifiedName);
      if (tool?.autoApprove) {
        // No dialog needed; backend auto-approves on its side too.
        return;
      }
      void (async () => {
        const ok = await dialog.confirm({
          title: 'Tool call request',
          message: `${ev.qualifiedName}\n\n${JSON.stringify(ev.args, null, 2)}`,
          confirmLabel: 'Approve',
          cancelLabel: 'Reject',
        });
        await mcpApi.decide(ev.id, ok ? 'approve' : 'reject').catch(() => {});
      })();
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, [dialog]);
}
