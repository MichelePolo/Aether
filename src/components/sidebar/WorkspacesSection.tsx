import { Pencil, Trash2 } from 'lucide-react';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useDialog } from '@/src/hooks/useDialog';
import { cn } from '@/src/lib/cn';

export function WorkspacesSection() {
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const remove = useWorkspacesStore((s) => s.remove);
  const rename = useWorkspacesStore((s) => s.rename);
  const dialog = useDialog();

  const activeWorkspaceId = useSessionsStore((s) => {
    const session = s.sessions.find((x) => x.id === s.activeSessionId);
    return session?.workspaceId;
  });

  const handleRename = async (id: string, current: string) => {
    const next = await dialog.prompt({
      title: 'Rename workspace',
      label: 'Name',
      defaultValue: current,
      required: true,
    });
    if (next) await rename(id, next).catch(() => {});
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await dialog.confirm({
      title: 'Delete workspace',
      message: `Delete "${name}"? Sessions assigned to it will keep working but lose their workspace.`,
      destructive: true,
    });
    if (ok) await remove(id).catch(() => {});
  };

  return (
    <section>
      <div className="space-y-1">
        {workspaces.map((w) => {
          const isActive = w.id === activeWorkspaceId;
          return (
            <div
              key={w.id}
              data-testid="workspace-row"
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'group flex items-center gap-2 p-1.5 border rounded text-[10px] font-mono',
                isActive
                  ? 'bg-disclosure/10 border-disclosure/40 text-disclosure'
                  : 'bg-zinc-900 border-border-subtle text-zinc-300',
              )}
            >
              <span className="flex-1 truncate">{w.name}</span>
              <span
                className="text-zinc-600 truncate max-w-[140px] direction-rtl text-left"
                title={w.rootPath}
                dir="rtl"
              >
                {w.rootPath}
              </span>
              <div className="hidden group-hover:flex group-focus-within:flex gap-1">
                <button
                  type="button"
                  aria-label={`Rename ${w.name}`}
                  onClick={() => void handleRename(w.id, w.name)}
                  className="text-zinc-500 hover:text-white px-1"
                >
                  <Pencil size={11} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`delete ${w.name}`}
                  onClick={() => void handleDelete(w.id, w.name)}
                  className="text-zinc-500 hover:text-status-error px-1"
                >
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
