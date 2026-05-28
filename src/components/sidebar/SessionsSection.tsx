import { Download, Pencil, Trash2 } from 'lucide-react';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useChatStore } from '@/src/stores/chat.store';
import { useDialog } from '@/src/hooks/useDialog';
import type { SessionMeta } from '@/src/types/session.types';
import { cn } from '@/src/lib/cn';
import { sessionsApi } from '@/src/lib/api/sessions.api';
import { t } from '@/src/i18n/t';

const FALLBACK_TITLE = t('sessionsSection.fallbackTitle');

interface SessionRowProps {
  session: SessionMeta;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  onExport: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function SessionRow({ session, active, disabled, onSelect, onExport, onRename, onDelete }: SessionRowProps) {
  const label = session.title || FALLBACK_TITLE;
  return (
    <div
      className={cn(
        'group flex items-center justify-between p-1.5 rounded text-[10px] font-mono border transition-colors',
        active
          ? 'bg-disclosure/10 border-disclosure/40 text-disclosure'
          : 'bg-zinc-900 border-border-subtle text-zinc-400 hover:text-zinc-200',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <button
        type="button"
        onClick={disabled ? undefined : onSelect}
        disabled={disabled}
        aria-current={active ? 'true' : undefined}
        className="flex-1 text-left truncate disabled:cursor-not-allowed"
      >
        {label}
      </button>
      <div className="hidden group-hover:flex group-focus-within:flex gap-1">
        <button
          onClick={onExport}
          disabled={disabled}
          aria-label={`Export ${label}`}
          className="hover:text-white disabled:opacity-50"
        >
          <Download size={12} aria-hidden="true" />
        </button>
        <button
          onClick={onRename}
          disabled={disabled}
          aria-label={`Rename ${label}`}
          className="hover:text-white disabled:opacity-50"
        >
          <Pencil size={12} aria-hidden="true" />
        </button>
        <button
          onClick={onDelete}
          disabled={disabled}
          aria-label={`Delete ${label}`}
          className="hover:text-status-error disabled:opacity-50"
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function SessionsSection() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);
  const error = useSessionsStore((s) => s.error);
  const setActive = useSessionsStore((s) => s.setActive);
  const create = useSessionsStore((s) => s.create);
  const rename = useSessionsStore((s) => s.rename);
  const remove = useSessionsStore((s) => s.delete);
  const clearError = useSessionsStore((s) => s.clearError);
  const isStreaming = useChatStore((s) => s.streamingId !== null);
  const dialog = useDialog();

  const handleNew = async () => {
    await create().catch(() => {});
  };

  const handleRename = async (id: string, current: string) => {
    const next = await dialog.prompt({
      title: 'Rename session',
      label: 'Title',
      defaultValue: current,
      required: true,
    });
    if (next) await rename(id, next).catch(() => {});
  };

  const handleDelete = async (id: string, label: string) => {
    const ok = await dialog.confirm({
      title: 'Delete session',
      message: `Delete "${label}"? ${t('sessionsSection.deleteIrreversible')}`,
      destructive: true,
    });
    if (ok) await remove(id).catch(() => {});
  };

  const handleExport = (id: string) => {
    window.location.assign(sessionsApi.exportSessionUrl(id));
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Sessions</div>
        <span className="text-[10px] text-zinc-600">[{sessions.length}]</span>
      </div>

      {error && (
        <div role="alert" className="mb-2 p-1.5 rounded bg-status-error/10 border border-status-error/40 text-status-error text-[10px] flex items-center gap-2">
          <span className="flex-1">⚠ {error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={clearError}
            className="hover:text-white"
          >
            ×
          </button>
        </div>
      )}

      <div className="space-y-1">
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeSessionId}
            disabled={isStreaming}
            onSelect={() => setActive(s.id)}
            onExport={() => handleExport(s.id)}
            onRename={() => handleRename(s.id, s.title || FALLBACK_TITLE)}
            onDelete={() => handleDelete(s.id, s.title || FALLBACK_TITLE)}
          />
        ))}
        <button
          onClick={handleNew}
          aria-label="New session"
          disabled={isStreaming}
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + New Session
        </button>
      </div>
    </section>
  );
}
