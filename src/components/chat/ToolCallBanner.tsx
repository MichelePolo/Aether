import { useMcpStore } from '@/src/stores/mcp.store';
import { mcpApi } from '@/src/lib/api/mcp.api';

export function ToolCallBanner() {
  const inFlightMap = useMcpStore((s) => s.inFlightCalls);
  const inFlight = Object.values(inFlightMap);

  if (inFlight.length === 0) return null;

  return (
    <div className="absolute bottom-16 left-0 right-0 mx-auto max-w-2xl flex flex-col gap-1 px-3 pointer-events-none">
      {inFlight.map((call) => (
        <div
          key={call.callId}
          className="pointer-events-auto flex items-center justify-between p-2 rounded bg-surface-2 border border-accent/40 text-[10px] font-mono"
        >
          <div className="flex flex-col min-w-0">
            <span className="text-zinc-300 truncate">{call.qualifiedName}</span>
            {call.progressNote && (
              <span className="text-zinc-500 italic truncate">{call.progressNote}</span>
            )}
          </div>
          <button
            type="button"
            aria-label={`Cancel ${call.qualifiedName}`}
            onClick={() => {
              mcpApi.cancelCall(call.callId).catch(() => {});
            }}
            className="ml-2 text-status-error hover:text-white"
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}
