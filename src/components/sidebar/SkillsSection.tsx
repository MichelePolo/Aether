import { useContextStore } from '@/src/stores/context.store';
import { useDialog } from '@/src/hooks/useDialog';

export function SkillsSection() {
  const skills = useContextStore((s) => s.context?.skills ?? []);
  const addSkill = useContextStore((s) => s.addSkill);
  const updateSkillAt = useContextStore((s) => s.updateSkillAt);
  const removeSkillAt = useContextStore((s) => s.removeSkillAt);
  const dialog = useDialog();

  const handleAdd = async () => {
    const name = await dialog.prompt({ title: 'Add Skill', label: 'Skill name', required: true });
    if (name) await addSkill(name).catch(() => {});
  };

  const handleEdit = async (index: number, current: string) => {
    const name = await dialog.prompt({
      title: 'Edit Skill',
      label: 'Skill name',
      defaultValue: current,
      required: true,
    });
    if (name) await updateSkillAt(index, name).catch(() => {});
  };

  const handleRemove = async (index: number, current: string) => {
    const ok = await dialog.confirm({
      title: 'Remove skill',
      message: `Remove "${current}"?`,
      destructive: true,
    });
    if (ok) await removeSkillAt(index).catch(() => {});
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Active Skills</div>
        <span className="text-[10px] text-zinc-600">[{skills.length}]</span>
      </div>
      <div className="space-y-1">
        {skills.map((skill, i) => (
          <div
            key={`${i}-${skill}`}
            className="group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono text-zinc-400"
          >
            <span className="truncate">{skill}</span>
            <div className="hidden group-hover:flex gap-1">
              <button
                onClick={() => handleEdit(i, skill)}
                aria-label={`Edit ${skill}`}
                className="hover:text-white"
              >
                ✎
              </button>
              <button
                onClick={() => handleRemove(i, skill)}
                aria-label={`Remove ${skill}`}
                className="hover:text-red-400"
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={handleAdd}
          aria-label="Add skill"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + Deploy New Skill
        </button>
      </div>
    </section>
  );
}
