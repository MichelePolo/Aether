import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { useUiStore } from '@/src/stores/ui.store';

export function WorkspacesSection() {
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const remove = useWorkspacesStore((s) => s.remove);
  const openBrowser = useUiStore((s) => s.openWorkspaceBrowser);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <span className="mono-label">Workspaces</span>
        <button
          type="button"
          onClick={openBrowser}
          className="text-[10px] text-accent hover:underline"
        >
          + Add workspace…
        </button>
      </div>
      <div className="space-y-1">
        {workspaces.map((w) => (
          <div
            key={w.id}
            data-testid="workspace-row"
            className="group flex items-center gap-2 p-1.5 bg-zinc-900 border border-border-subtle rounded text-[10px] font-mono"
          >
            <span className="text-zinc-300 flex-1 truncate">{w.name}</span>
            <span className="text-zinc-600 truncate" title={w.rootPath}>
              {w.rootPath}
            </span>
            <button
              type="button"
              aria-label={`delete ${w.name}`}
              onClick={() => void remove(w.id)}
              className="hidden group-hover:flex text-zinc-500 hover:text-rose-400 px-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
