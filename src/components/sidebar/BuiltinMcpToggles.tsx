import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import type { BuiltinTransport } from '@/src/types/mcp.types';
import { cn } from '@/src/lib/cn';

const ROW_ORDER: BuiltinTransport[] = ['filesystem', 'terminal'];

const LABEL: Record<BuiltinTransport, string> = {
  filesystem: 'Filesystem',
  terminal: 'Terminal',
};

const DOT_CLASS: Record<string, string> = {
  online: 'text-status-ok',
  connecting: 'text-status-warn',
  reconnecting: 'text-status-warn',
  error: 'text-status-error',
  offline: 'text-zinc-500',
};

export function BuiltinMcpToggles() {
  const builtins = useBuiltinMcpStore((s) => s.builtins);
  const toggle = useBuiltinMcpStore((s) => s.toggle);
  const connectStates = useMcpStore((s) => s.connectStates);

  if (builtins.length === 0) return null;

  return (
    <section>
      <div className="mono-label mb-2">Coding Tools</div>
      <div className="space-y-1">
        {ROW_ORDER.map((t) => {
          const row = builtins.find((b) => b.transport === t);
          if (!row) return null;
          const liveState = connectStates[`builtin:${t}`] ?? 'offline';
          const dotClass = DOT_CLASS[liveState] ?? 'text-zinc-500';
          return (
            <div
              key={t}
              data-testid="builtin-mcp-row"
              className="flex items-center gap-2 p-1.5 bg-zinc-900 border border-border-subtle rounded text-[10px] font-mono"
            >
              <span data-state={liveState} className={cn(dotClass)}>●</span>
              <span className="text-zinc-300">{LABEL[t]}</span>
              {t === 'filesystem' && (
                <span className="flex-1 text-zinc-600 truncate" title={row.fsRoot ?? 'default'}>
                  {row.fsRoot ?? 'default'}
                </span>
              )}
              {t !== 'filesystem' && <span className="flex-1" />}
              <button
                type="button"
                role="switch"
                aria-checked={row.enabled}
                aria-label={`Toggle ${LABEL[t]}`}
                onClick={() => void toggle(t)}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] border',
                  row.enabled
                    ? 'bg-accent/20 text-accent border-accent/40'
                    : 'bg-surface-1 text-zinc-500 border-border-subtle hover:text-zinc-300',
                )}
              >
                {row.enabled ? 'On' : 'Off'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
