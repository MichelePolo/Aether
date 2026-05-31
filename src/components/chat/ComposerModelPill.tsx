import { useRef, useState } from 'react';
import { ChevronDown, Check, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/src/lib/cn';
import { t } from '@/src/i18n/t';
import { useDismiss } from '@/src/hooks/useDismiss';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

/**
 * Composer-embedded model selector (moved here from the TopBar). Switches the
 * active session's provider and the default for new sessions — same semantics
 * as the old ProviderSelector, presented as a Claude-style pill + dropdown.
 */
export function ComposerModelPill() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, () => setOpen(false), open);

  const list = useProvidersStore((s) => s.list);
  const defaultProvider = useProvidersStore((s) => s.defaultProvider);
  const setDefault = useProvidersStore((s) => s.setDefault);
  const refresh = useProvidersStore((s) => s.refresh);
  const issues = useProvidersStore((s) => s.issues);

  const activeId = useSessionsStore((s) => s.activeSessionId);
  const sessions = useSessionsStore((s) => s.sessions);
  const setProviderName = useSessionsStore((s) => s.setProviderName);

  const activeSession = activeId ? sessions.find((s) => s.id === activeId) : null;
  const activeName =
    (activeSession as { providerName?: string } | null)?.providerName ?? defaultProvider ?? '';
  const activeLabel = list.find((p) => p.name === activeName)?.displayName ?? activeName ?? 'No model';

  const select = async (name: string): Promise<void> => {
    setOpen(false);
    if (activeId) await setProviderName(activeId, name).catch(() => {});
    setDefault(name);
  };

  const issueLabel = (transport: string, reason: string): string => {
    const name = transport.charAt(0).toUpperCase() + transport.slice(1);
    return t('composerModelPill.fetchFailed', { provider: name, reason });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Select model"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono transition-colors max-w-[220px]',
          open ? 'bg-surface-3 text-zinc-200' : 'text-zinc-400 hover:text-zinc-200 hover:bg-surface-3',
        )}
      >
        <span className="truncate">{activeLabel}</span>
        <ChevronDown size={13} className="shrink-0 opacity-70" />
      </button>
      {open && (
        <div
          role="menu"
          className="chat-scroll absolute bottom-full left-0 mb-2 z-20 min-w-[240px] max-h-72 overflow-y-auto bg-surface-3 border border-border-subtle rounded-lg shadow-lg py-1"
        >
          {list.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500 font-mono">No models available</div>
          )}
          {list.map((p) => {
            const isActive = p.name === activeName;
            return (
              <button
                key={p.name}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => void select(p.name)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-left hover:bg-surface-4',
                  isActive ? 'text-disclosure' : 'text-zinc-300',
                )}
              >
                <Check size={13} className={cn('shrink-0', isActive ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{p.displayName}</span>
              </button>
            );
          })}
          {issues
            .filter((iss) => !list.some((p) => p.transport === iss.transport))
            .map((iss) => (
              <div
                key={`issue:${iss.transport}`}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-zinc-500 cursor-not-allowed"
                aria-disabled="true"
              >
                <AlertTriangle size={13} className="shrink-0 text-yellow-500" aria-hidden="true" />
                <span className="truncate">{issueLabel(iss.transport, iss.reason)}</span>
              </div>
            ))}
          <div className="border-t border-border-subtle my-1" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              refresh().catch(() => {});
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 hover:bg-surface-4 hover:text-zinc-200"
          >
            <RefreshCw size={13} className="shrink-0" />
            Refresh models
          </button>
        </div>
      )}
    </div>
  );
}
