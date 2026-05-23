import { useEffect, useState } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { useKeyVaultStore } from '@/src/stores/keyVault.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { Modal } from '@/src/components/ui/Modal';
import { cn } from '@/src/lib/cn';
import type { VaultTransport } from '@/src/types/key-vault.types';
import type { ProviderTransport } from '@/src/types/provider-auth.types';

// Fixed display order for all 5 rows
const ROW_ORDER = ['anthropic', 'anthropic-oauth', 'openai', 'gemini', 'ollama'] as const;
type RowTransport = (typeof ROW_ORDER)[number];

// Labels for display
const LABEL: Record<RowTransport, string> = {
  anthropic: 'Anthropic',
  'anthropic-oauth': 'Anthropic OAuth',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama',
};

// Vault transports that have an editable key input
const VAULT_TRANSPORTS = new Set<RowTransport>(['anthropic', 'openai', 'gemini']);

// Map transport to ProviderTransport for status lookups
const TO_PROVIDER_TRANSPORT: Partial<Record<RowTransport, ProviderTransport>> = {
  anthropic: 'anthropic',
  'anthropic-oauth': 'anthropic',
  openai: 'openai',
  gemini: 'gemini',
  ollama: 'ollama',
};

function dotStateClass(state: string | undefined): string {
  if (state === 'ok') return 'text-status-ok';
  if (state === 'error') return 'text-status-error';
  return 'text-zinc-500';
}

// ---- Vault Row (editable: anthropic, openai, gemini) ----

interface VaultRowProps {
  transport: VaultTransport;
  autoFocus: boolean;
  statusState: string | undefined;
}

function VaultRow({ transport, autoFocus, statusState }: VaultRowProps) {
  const vault = useKeyVaultStore((s) => s.vault);
  const save = useKeyVaultStore((s) => s.save);
  const clear = useKeyVaultStore((s) => s.clear);
  const reveal = useKeyVaultStore((s) => s.reveal);

  const row = vault.find((r) => r.transport === transport);
  const masked = row?.masked ?? '';

  const [inputValue, setInputValue] = useState('');
  const [revealedText, setRevealedText] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Auto-mask revealed text after 10s
  useEffect(() => {
    if (!revealedText) return;
    const timer = setTimeout(() => setRevealedText(null), 10_000);
    return () => clearTimeout(timer);
  }, [revealedText]);

  // Revert "Confirm clear?" label after 4s
  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 4_000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  // Reset revealed state when component unmounts (modal close)
  useEffect(() => {
    return () => {
      setRevealedText(null);
    };
  }, []);

  const displayValue = revealedText ?? inputValue;

  const handleSave = async () => {
    if (!inputValue.trim()) return;
    await save(transport, inputValue.trim()).catch(() => {});
    setInputValue('');
  };

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    await clear(transport).catch(() => {});
  };

  const handleReveal = async () => {
    if (revealedText) {
      setRevealedText(null);
      return;
    }
    const plaintext = await reveal(transport).catch(() => null);
    if (plaintext) setRevealedText(plaintext);
  };

  return (
    <div data-testid="key-vault-row" className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center gap-2">
        <span
          data-testid="status-dot"
          data-state={statusState ?? 'unknown'}
          className={cn('w-2 h-2 rounded-full flex-shrink-0', dotStateClass(statusState))}
        >
          ●
        </span>
        <span className="mono-label text-zinc-300">{LABEL[transport]}</span>
        {masked && (
          <span className="text-[10px] font-mono text-zinc-600 ml-auto">{masked}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type={revealedText ? 'text' : 'password'}
          aria-label={`${LABEL[transport]} key`}
          autoFocus={autoFocus}
          value={displayValue}
          onChange={(e) => {
            if (!revealedText) setInputValue(e.target.value);
          }}
          placeholder={masked || 'Enter API key…'}
          className="flex-1 min-w-0 bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-accent/60"
        />
        <button
          type="button"
          aria-label={`Save ${transport}`}
          onClick={handleSave}
          disabled={!inputValue.trim()}
          className="px-2 py-1 rounded text-[10px] font-mono bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
        {row?.hasKey && (
          <>
            <button
              type="button"
              aria-label={`Reveal ${transport}`}
              onClick={handleReveal}
              className="px-2 py-1 rounded text-[10px] font-mono bg-surface-2 text-zinc-400 hover:text-white border border-border-subtle"
            >
              {revealedText ? 'Hide' : 'Reveal'}
            </button>
            <button
              type="button"
              aria-label={`Clear ${transport}`}
              onClick={handleClear}
              className={cn(
                'px-2 py-1 rounded text-[10px] font-mono border',
                confirmClear
                  ? 'bg-status-error/15 text-status-error border-status-error/40 hover:bg-status-error/25'
                  : 'bg-surface-2 text-zinc-400 hover:text-white border-border-subtle',
              )}
            >
              {confirmClear ? 'Confirm clear?' : 'Clear'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Info Row (read-only: anthropic-oauth, ollama) ----

interface InfoRowProps {
  transport: 'anthropic-oauth' | 'ollama';
  statusState: string | undefined;
}

function InfoRow({ transport, statusState }: InfoRowProps) {
  const info = useKeyVaultStore((s) => s.info);
  const row = info.find((r) => r.transport === transport);

  return (
    <div data-testid="key-vault-row" className="flex items-center gap-2 py-2">
      <span
        data-testid="status-dot"
        data-state={statusState ?? 'unknown'}
        className={cn('w-2 h-2 rounded-full flex-shrink-0', dotStateClass(statusState))}
      >
        ●
      </span>
      <span className="mono-label text-zinc-300">{LABEL[transport]}</span>
      {row && (
        <span className="text-[10px] font-mono text-zinc-500 ml-auto">{row.status}</span>
      )}
      <span className="text-[10px] font-mono text-zinc-600 italic">read-only</span>
    </div>
  );
}

// ---- KeyVaultModal ----

export function KeyVaultModal() {
  const open = useUiStore((s) => s.keyVaultOpen);
  const close = useUiStore((s) => s.closeKeyVault);
  const focusTransport = useUiStore((s) => s.keyVaultFocusTransport);
  const error = useKeyVaultStore((s) => s.error);
  const statuses = useProviderAuthStore((s) => s.statuses);
  const initVault = useKeyVaultStore((s) => s.init);

  const statusMap = Object.fromEntries(statuses.map((s) => [s.transport, s]));

  useEffect(() => {
    if (open) {
      initVault().catch(() => {});
    }
  }, [open, initVault]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={close} title="API Keys" className="max-w-lg">
      <div className="flex flex-col gap-0 divide-y divide-border-subtle">
        {error && (
          <div className="mb-3 text-[10px] font-mono text-status-error bg-status-error/10 rounded px-2 py-1">
            {error}
          </div>
        )}
        {ROW_ORDER.map((transport) => {
          const providerT = TO_PROVIDER_TRANSPORT[transport];
          const statusState = providerT ? statusMap[providerT]?.state : undefined;

          if (VAULT_TRANSPORTS.has(transport)) {
            return (
              <VaultRow
                key={transport}
                transport={transport as VaultTransport}
                autoFocus={focusTransport === transport}
                statusState={statusState}
              />
            );
          }
          return (
            <InfoRow
              key={transport}
              transport={transport as 'anthropic-oauth' | 'ollama'}
              statusState={statusState}
            />
          );
        })}
      </div>
    </Modal>
  );
}
