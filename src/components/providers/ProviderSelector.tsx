import type { ChangeEvent } from 'react';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { RefreshCw } from 'lucide-react';

export function ProviderSelector() {
  const list = useProvidersStore((s) => s.list);
  const defaultProvider = useProvidersStore((s) => s.defaultProvider);
  const setDefault = useProvidersStore((s) => s.setDefault);
  const refresh = useProvidersStore((s) => s.refresh);

  const activeId = useSessionsStore((s) => s.activeSessionId);
  const sessions = useSessionsStore((s) => s.sessions);
  const setProviderName = useSessionsStore((s) => s.setProviderName);

  const activeSession = activeId ? sessions.find((s) => s.id === activeId) : null;
  const activeName = (activeSession as { providerName?: string } | null)?.providerName ?? defaultProvider ?? '';

  const handleChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
    if (activeId) await setProviderName(activeId, name).catch(() => {});
    setDefault(name);
  };

  const knownNames = new Set(list.map((p) => p.name));
  const showUnavailable = !!activeName && !knownNames.has(activeName);

  return (
    <div className="ml-2 flex items-center gap-1">
      <select
        aria-label="Active provider"
        value={activeName}
        onChange={handleChange}
        className="bg-surface-3 border border-border-subtle rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-300"
      >
        {showUnavailable && (
          <option value={activeName} disabled>
            (unavailable) {activeName}
          </option>
        )}
        {list.map((p) => (
          <option key={p.name} value={p.name}>
            {p.displayName}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Refresh providers"
        onClick={() => refresh().catch(() => {})}
        className="p-1 text-zinc-500 hover:text-white"
      >
        <RefreshCw size={12} />
      </button>
    </div>
  );
}
