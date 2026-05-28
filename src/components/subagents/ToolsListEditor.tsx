import { addToolFlow } from '@/src/lib/context/addFlows';
import { useDialog } from '@/src/hooks/useDialog';
import { StatusDot } from '@/src/components/ui/StatusDot';
import type { Tool } from '@/src/types/context.types';

export interface ToolsListEditorProps {
  tools: Tool[];
  onAdd: (tool: Tool) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
}

export function ToolsListEditor({ tools, onAdd, onRemove }: ToolsListEditorProps) {
  const dialog = useDialog();

  const handleAdd = () =>
    addToolFlow(dialog, async (input) => {
      const tool: Tool = { id: crypto.randomUUID(), ...input };
      await onAdd(tool);
    });

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Tools</div>
        <span className="text-[10px] text-zinc-600">[{tools.length}]</span>
      </div>
      <div className="space-y-1">
        {tools.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono italic">No tools.</div>
        ) : (
          tools.map((tool) => (
            <div
              key={tool.id}
              className="group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono text-zinc-400"
            >
              <div className="flex items-center gap-2 truncate">
                <span className="truncate">{tool.name}</span>
                <span className="text-zinc-600">{tool.version}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={`Remove tool ${tool.name}`}
                  onClick={() => onRemove(tool.id)}
                  className="hidden group-hover:inline hover:text-status-error text-zinc-500"
                >
                  ×
                </button>
                <StatusDot status={tool.status} label={tool.name} />
              </div>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={handleAdd}
          aria-label="Add tool"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + Add tool
        </button>
      </div>
    </section>
  );
}
