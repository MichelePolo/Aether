import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useDialog } from '@/src/hooks/useDialog';
import { useUiStore } from '@/src/stores/ui.store';

export function SubAgentsSection() {
  const list = useSubAgentsStore((s) => s.list);
  const error = useSubAgentsStore((s) => s.error);
  const create = useSubAgentsStore((s) => s.create);
  const remove = useSubAgentsStore((s) => s.delete);
  const clearError = useSubAgentsStore((s) => s.clearError);
  const dialog = useDialog();
  const openSubAgentEditor = useUiStore((s) => s.openSubAgentEditor);

  const handleAdd = async () => {
    const name = await dialog.prompt({
      title: 'New sub-agent',
      label: 'Name',
      required: true,
    });
    if (!name) return;
    const systemInstruction = await dialog.prompt({
      title: 'New sub-agent',
      label: 'System instruction',
      multiline: true,
    });
    if (systemInstruction === null) return;
    await create({ name, systemInstruction }).catch(() => {});
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await dialog.confirm({
      title: 'Delete sub-agent',
      message: `Delete "${name}"?`,
      destructive: true,
    });
    if (ok) await remove(id).catch(() => {});
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Sub-agents</div>
        <span className="text-[10px] text-zinc-600">[{list.length}]</span>
      </div>

      {error && (
        <div className="mb-2 p-1.5 rounded bg-status-error/10 border border-status-error/40 text-status-error text-[10px] flex items-center gap-2">
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
        {list.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono italic">
            No sub-agents defined.
          </div>
        ) : (
          list.map((sa) => (
            <div
              key={sa.id}
              onClick={() => openSubAgentEditor(sa.id)}
              className="group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono text-zinc-400 cursor-pointer hover:border-accent/40"
            >
              <span className="truncate">{sa.name}</span>
              <div className="hidden group-hover:flex gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(sa.id, sa.name);
                  }}
                  aria-label={`Delete ${sa.name}`}
                  className="hover:text-red-400"
                >
                  ×
                </button>
              </div>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={handleAdd}
          aria-label="New sub-agent"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + New sub-agent
        </button>
      </div>
    </section>
  );
}
