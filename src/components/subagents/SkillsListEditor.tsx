import { addSkillFlow } from '@/src/lib/context/addFlows';
import { useDialog } from '@/src/hooks/useDialog';

export interface SkillsListEditorProps {
  skills: string[];
  onAdd: (name: string) => Promise<void> | void;
  onRemove: (index: number) => Promise<void> | void;
}

export function SkillsListEditor({ skills, onAdd, onRemove }: SkillsListEditorProps) {
  const dialog = useDialog();

  const handleAdd = () =>
    addSkillFlow(dialog, async (name) => {
      await onAdd(name);
    });

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Skills</div>
        <span className="text-[10px] text-zinc-600">[{skills.length}]</span>
      </div>
      <div className="space-y-1">
        {skills.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono italic">No skills.</div>
        ) : (
          skills.map((skill, i) => (
            <div
              key={`${i}-${skill}`}
              className="group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono text-zinc-400"
            >
              <span className="truncate">{skill}</span>
              <button
                type="button"
                aria-label={`Remove skill ${skill}`}
                onClick={() => onRemove(i)}
                className="hidden group-hover:inline hover:text-red-400 text-zinc-500"
              >
                ×
              </button>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={handleAdd}
          aria-label="Add skill"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + Add skill
        </button>
      </div>
    </section>
  );
}
