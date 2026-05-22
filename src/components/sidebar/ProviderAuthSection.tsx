import { RefreshCw } from 'lucide-react';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { TRANSPORT_ORDER } from '@/src/types/provider-auth.types';
import type { ProviderTransport, TransportStatus } from '@/src/types/provider-auth.types';
import { cn } from '@/src/lib/cn';

const TRANSPORT_LABELS: Record<ProviderTransport, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama',
};

function dotClass(state: TransportStatus['state']): string {
  if (state === 'ok') return 'text-status-ok';
  if (state === 'error') return 'text-status-error';
  return 'text-zinc-500';
}

export function ProviderAuthSection() {
  const statuses = useProviderAuthStore((s) => s.statuses);
  const loading = useProviderAuthStore((s) => s.loading);
  const error = useProviderAuthStore((s) => s.error);
  const refresh = useProviderAuthStore((s) => s.refresh);

  const statusMap = Object.fromEntries(statuses.map((s) => [s.transport, s])) as
    Partial<Record<ProviderTransport, TransportStatus>>;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Providers</div>
        <button
          type="button"
          aria-label="Refresh provider auth"
          onClick={() => refresh().catch(() => {})}
          className={cn(
            'text-zinc-400 hover:text-white transition-colors',
            loading && 'animate-spin',
          )}
        >
          <RefreshCw size={10} />
        </button>
      </div>

      {error && (
        <div className="mb-2 text-[10px] font-mono text-status-error bg-status-error/10 rounded px-2 py-1">
          {error}
        </div>
      )}

      <div className="space-y-1">
        {TRANSPORT_ORDER.map((transport) => {
          const s = statusMap[transport];
          const state = s?.state ?? 'unconfigured';
          const reason = s?.reason ?? '';
          const detail = s?.detail ?? '';
          return (
            <div
              key={transport}
              data-testid="provider-auth-row"
              title={detail}
              className="flex items-center gap-1.5 text-[10px] font-mono px-1"
            >
              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', {
                'bg-status-ok': state === 'ok',
                'bg-status-error': state === 'error',
                'bg-zinc-500': state === 'unconfigured',
              })} />
              <span className={cn('flex-shrink-0', dotClass(state))}>
                {TRANSPORT_LABELS[transport]}
              </span>
              {reason && (
                <span className="text-zinc-600 truncate">/ {reason}</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
