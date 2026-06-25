import { Settings2 } from 'lucide-react';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { TRANSPORT_ORDER } from '@/src/types/provider-auth.types';
import type { ProviderTransport, TransportStatus } from '@/src/types/provider-auth.types';
import { cn } from '@/src/lib/cn';
import { useUiStore } from '@/src/stores/ui.store';
import type { VaultTransport } from '@/src/types/key-vault.types';
import type { OllamaEndpointStatus } from '@/src/types/ollama-endpoints.types';
import type { OpenAICompatEndpointStatus } from '@/src/types/openai-endpoints.types';

const TRANSPORT_LABELS: Record<ProviderTransport, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama',
  'openai-compat': 'OpenAI-compat',
};

function dotClass(state: TransportStatus['state']): string {
  if (state === 'ok') return 'text-status-ok';
  if (state === 'error') return 'text-status-error';
  return 'text-zinc-500';
}

const VAULT_SET = new Set<VaultTransport>(['anthropic', 'openai', 'gemini']);

export function ProviderAuthSection() {
  const statuses = useProviderAuthStore((s) => s.statuses);
  const ollama = useProviderAuthStore((s) => s.ollama);
  const openaiCompat = useProviderAuthStore((s) => s.openaiCompat);
  const error = useProviderAuthStore((s) => s.error);
  const openKeyVault = useUiStore((s) => s.openKeyVault);
  const openOllamaEndpoints = useUiStore((s) => s.openOllamaEndpoints);
  const openOpenAIEndpoints = useUiStore((s) => s.openOpenAIEndpoints);

  const statusMap = Object.fromEntries(statuses.map((s) => [s.transport, s])) as
    Partial<Record<ProviderTransport, TransportStatus>>;

  return (
    <section>
      {error && (
        <div className="mb-2 text-[10px] font-mono text-status-error bg-status-error/10 rounded px-2 py-1">
          {error}
        </div>
      )}

      <div className="space-y-1">
        {TRANSPORT_ORDER.filter((transport) => transport !== 'ollama' && transport !== 'openai-compat').map((transport) => {
          const s = statusMap[transport];
          const state = s?.state ?? 'unconfigured';
          const reason = s?.reason ?? '';
          const detail = s?.detail ?? '';
          const clickable = state !== 'ok' && VAULT_SET.has(transport as VaultTransport);
          return (
            <div
              key={transport}
              data-testid="provider-auth-row"
              title={detail}
              onClick={clickable ? () => openKeyVault(transport as VaultTransport) : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              className={cn(
                'flex items-center gap-1.5 text-[10px] font-mono px-1 py-1 rounded',
                clickable && 'cursor-pointer hover:bg-surface-3',
              )}
            >
              <span
                role="img"
                aria-label={`${TRANSPORT_LABELS[transport]} status: ${state}`}
                className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', {
                  'bg-status-ok': state === 'ok',
                  'bg-status-error': state === 'error',
                  'bg-zinc-500': state === 'unconfigured',
                })}
              />
              <span className={cn('flex-shrink-0', dotClass(state))}>
                {TRANSPORT_LABELS[transport]}
              </span>
              {reason && (
                <span className="text-zinc-600 truncate">/ {reason}</span>
              )}
            </div>
          );
        })}

        <div className="pt-1">
          <button
            type="button"
            aria-label="Manage Ollama endpoints"
            onClick={openOllamaEndpoints}
            className="flex items-center gap-1.5 w-full text-[10px] font-mono px-1 py-1 rounded text-zinc-400 hover:text-white hover:bg-surface-3"
          >
            <Settings2 size={10} />
            <span>Ollama</span>
          </button>
          {ollama.map((ep: OllamaEndpointStatus) => (
            <div
              key={ep.id}
              data-testid="ollama-status-row"
              title={ep.detail ?? ''}
              className="flex items-center gap-1.5 text-[10px] font-mono px-1 py-1 pl-3 rounded"
            >
              <span
                role="img"
                aria-label={`Ollama ${ep.label} status: ${ep.state}`}
                className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', {
                  'bg-status-ok': ep.state === 'ok',
                  'bg-status-error': ep.state === 'error',
                  'bg-zinc-500': ep.state === 'unconfigured',
                })}
              />
              <span className="flex-shrink-0 text-zinc-300">{ep.label}</span>
              {ep.fixed && ep.label !== 'local' && <span className="text-zinc-600">/ local</span>}
              {ep.reason && <span className="text-zinc-600 truncate">/ {ep.reason}</span>}
            </div>
          ))}
        </div>

        <div className="pt-1">
          <button
            type="button"
            aria-label="Manage OpenAI-compat endpoints"
            onClick={openOpenAIEndpoints}
            className="flex items-center gap-1.5 w-full text-[10px] font-mono px-1 py-1 rounded text-zinc-400 hover:text-white hover:bg-surface-3"
          >
            <Settings2 size={10} />
            <span>OpenAI-compat</span>
          </button>
          {openaiCompat.map((ep: OpenAICompatEndpointStatus) => (
            <div
              key={ep.id}
              data-testid="openai-compat-status-row"
              title={ep.detail ?? ''}
              className="flex items-center gap-1.5 text-[10px] font-mono px-1 py-1 pl-3 rounded"
            >
              <span
                role="img"
                aria-label={`OpenAI-compat ${ep.label} status: ${ep.state}`}
                className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', {
                  'bg-status-ok': ep.state === 'ok',
                  'bg-status-error': ep.state === 'error',
                  'bg-zinc-500': ep.state === 'unconfigured',
                })}
              />
              <span className="flex-shrink-0 text-zinc-300">{ep.label}</span>
              {ep.reason && <span className="text-zinc-600 truncate">/ {ep.reason}</span>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
