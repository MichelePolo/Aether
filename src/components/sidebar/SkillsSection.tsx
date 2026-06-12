import type { Skill } from '@/server/domain/context/context.types';
import { addSkillFlow } from '@/src/lib/context/addFlows';
import { useContextStore } from '@/src/stores/context.store';
import { useDialog } from '@/src/hooks/useDialog';

const EMPTY_SKILLS: Skill[] = [];

export function SkillsSection() {
  const context = useContextStore((s) => s.context);
  const skills = context?.skills ?? EMPTY_SKILLS;
  const addSkill = useContextStore((s) => s.addSkill);
  const updateSkillAt = useContextStore((s) => s.updateSkillAt);
  const toggleSkillAt = useContextStore((s) => s.toggleSkillAt);
  const removeSkillAt = useContextStore((s) => s.removeSkillAt);
  const dialog = useDialog();

  const handleAdd = () => addSkillFlow(dialog, addSkill);

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
        <span className="text-[10px] text-zinc-600">
          [{skills.filter((s) => s.enabled).length}/{skills.length}]
        </span>
      </div>
      <div className="space-y-1">
        {skills.map((skill, i) => (
          <div
            key={`${i}-${skill.name}`}
            data-skill-row
            role="button"
            tabIndex={0}
            onClick={() => toggleSkillAt(i).catch(() => {})}
            aria-pressed={skill.enabled}
            className={`group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono cursor-pointer ${
              skill.enabled
                ? 'text-zinc-400 hover:border-manipulation/40'
                : 'text-zinc-600 line-through opacity-60'
            }`}
          >
            <span className="truncate">{skill.name}</span>
            <div className="hidden group-hover:flex gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleEdit(i, skill.name);
                }}
                aria-label={`Edit ${skill.name}`}
                className="hover:text-white"
              >
                ✎
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(i, skill.name);
                }}
                aria-label={`Remove ${skill.name}`}
                className="hover:text-status-error"
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
