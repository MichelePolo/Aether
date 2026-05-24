import { useEffect } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { useUiStore } from '@/src/stores/ui.store';
import { breakpointsApi } from '@/src/lib/api/breakpoints.api';
import { mcpApi } from '@/src/lib/api/mcp.api';

export interface ToolCallRequestEvent {
  callId: string;
  qualifiedName: string;
  args: Record<string, unknown>;
}

type Listener = (ev: ToolCallRequestEvent) => void;
const listeners = new Set<Listener>();

export function emitToolCallRequest(ev: ToolCallRequestEvent): void {
  for (const l of listeners) l(ev);
}

export function useToolCallDecisions(): void {
  useEffect(() => {
    const handler: Listener = (ev) => {
      const sticky = useChatStore.getState().stickyApprovals;
      if (sticky.has(ev.qualifiedName)) {
        void mcpApi.decide(ev.callId, 'approve').catch(() => {});
        return;
      }
      void (async () => {
        const preview = await breakpointsApi
          .preview({ qualifiedName: ev.qualifiedName, args: ev.args })
          .catch(() => ({ kind: 'plain' as const }));
        useUiStore.getState().openApprovalGate({ event: ev, preview });
      })();
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);
}
