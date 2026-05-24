import { useState } from 'react';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { t } from '@/src/i18n/t';

export function WorkspaceChip() {
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const sessions = useSessionsStore((s) => s.sessions);
  const setSessionWorkspace = useSessionsStore((s) => s.setSessionWorkspace);
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const [open, setOpen] = useState(false);

  const session = sessions.find((x) => x.id === activeId);
  const ws = session?.workspaceId
    ? workspaces.find((w) => w.id === session.workspaceId)
    : undefined;
  const label = ws ? ws.name : t('workspaceChip.noWorkspace');

  const pick = (id: string | null) => {
    setOpen(false);
    if (!activeId) return;
    void setSessionWorkspace(activeId, id);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('workspaceChip.label')}
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 text-[11px] font-mono text-zinc-300 border border-border-subtle rounded hover:bg-zinc-800"
      >
        <span aria-hidden="true">📁 </span>
        <span>{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 max-h-64 overflow-y-auto rounded border border-border-subtle bg-surface-1 shadow z-30">
          <button
            type="button"
            onClick={() => pick(null)}
            className="block w-full text-left px-2 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-800 italic"
          >
            {t('workspaceChip.noWorkspaceItalic')}
          </button>
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => pick(w.id)}
              className="block w-full text-left px-2 py-1.5 text-[11px] font-mono text-zinc-300 hover:bg-zinc-800 truncate"
            >
              {w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
