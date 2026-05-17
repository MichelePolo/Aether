import { useContextStore } from '@/src/stores/context.store';
import { useDialog } from '@/src/hooks/useDialog';
import { StatusDot } from '@/src/components/ui/StatusDot';

export function ToolsSection() {
  const tools = useContextStore((s) => s.context?.tools ?? []);
  const addTool = useContextStore((s) => s.addTool);
  const removeTool = useContextStore((s) => s.removeTool);
  const dialog = useDialog();

  const handleAdd = async () => {
    const name = await dialog.prompt({ title: 'Register Tool', label: 'Name', required: true });
    if (!name) return;
    const version = await dialog.prompt({
      title: 'Register Tool',
      label: 'Version',
      defaultValue: '1.0.0',
      required: true,
    });
    if (!version) return;
    const isOnline = await dialog.confirm({
      title: 'Register Tool',
      message: `Set status of ${name} to ONLINE? (Cancel = offline)`,
      confirmLabel: 'Online',
      cancelLabel: 'Offline',
    });
    await addTool({ name, version, status: isOnline ? 'online' : 'offline' }).catch(() => {});
  };

  const handleRemove = async (id: string, name: string) => {
    const ok = await dialog.confirm({
      title: 'Remove tool',
      message: `Remove "${name}"?`,
      destructive: true,
    });
    if (ok) await removeTool(id).catch(() => {});
  };

  return (
    <section>
      <div className="mono-label mb-2">Tool Registry</div>
      <div className="space-y-2">
        {tools.map((tool) => (
          <div
            key={tool.id}
            className="group p-2 rounded bg-zinc-900/30 border border-border-subtle/50 flex items-center justify-between"
          >
            <span className="text-[10px] font-mono text-zinc-500">
              {tool.name} <span className="opacity-50 mx-1">v{tool.version}</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleRemove(tool.id, tool.name)}
                aria-label={`Remove ${tool.name}`}
                className="hidden group-hover:inline hover:text-red-400 text-zinc-500"
              >
                ×
              </button>
              <StatusDot status={tool.status} label={tool.name} />
            </div>
          </div>
        ))}
        <button
          onClick={handleAdd}
          aria-label="Register tool"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + Register Tool
        </button>
      </div>
    </section>
  );
}
