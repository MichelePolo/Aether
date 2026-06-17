import type { Skill } from '@/server/domain/context/context.types';
import { addSkillFlow } from '@/src/lib/context/addFlows';
import { useContextStore } from '@/src/stores/context.store';
import { useSkillsStore } from '@/src/stores/skills.store';
import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store';
import { useUiStore } from '@/src/stores/ui.store';
import { useDialog } from '@/src/hooks/useDialog';
import { t } from '@/src/i18n/t';

const EMPTY_SKILLS: Skill[] = [];

export function SkillsSection() {
  const context = useContextStore((s) => s.context);
  const labelSkills = context?.skills ?? EMPTY_SKILLS;
  const addSkill = useContextStore((s) => s.addSkill);
  const updateSkillAt = useContextStore((s) => s.updateSkillAt);
  const toggleSkillAt = useContextStore((s) => s.toggleSkillAt);
  const removeSkillAt = useContextStore((s) => s.removeSkillAt);

  const materialSkills = useSkillsStore((s) => s.skills);
  const drafts = useSkillsStore((s) => s.drafts);
  const toggleEnabled = useSkillsStore((s) => s.toggleEnabled);
  const togglePinned = useSkillsStore((s) => s.togglePinned);
  const promote = useSkillsStore((s) => s.promote);
  const removeMaterial = useSkillsStore((s) => s.remove);
  const error = useSkillsStore((s) => s.error);
  const clearError = useSkillsStore((s) => s.clearError);
  const openCreateWithAi = useUiStore((s) => s.openCreatingSkill);

  const builtins = useBuiltinMcpStore((s) => s.builtins);
  const fsMcpEnabled = builtins.find((b) => b.transport === 'filesystem')?.enabled ?? true;
  const needsFsWarning =
    !fsMcpEnabled && materialSkills.some((s) => s.enabled && !s.pinned && !s.invalid);

  const dialog = useDialog();
  const handleAdd = () => addSkillFlow(dialog, addSkill);

  const handleEditLabel = async (index: number, current: string) => {
    const name = await dialog.prompt({
      title: 'Edit Skill',
      label: 'Skill name',
      defaultValue: current,
      required: true,
    });
    if (name) await updateSkillAt(index, name).catch(() => {});
  };

  const handleRemoveLabel = async (index: number, current: string) => {
    const ok = await dialog.confirm({
      title: 'Remove skill',
      message: `Remove "${current}"?`,
      destructive: true,
    });
    if (ok) await removeSkillAt(index).catch(() => {});
  };

  const handleRemoveMaterial = async (slug: string) => {
    const ok = await dialog.confirm({
      title: 'Remove skill',
      message: t('skills.removeConfirm', { name: slug }),
      destructive: true,
    });
    if (ok) await removeMaterial(slug).catch(() => {});
  };

  const handlePromote = async (slug: string) => {
    const ok = await dialog.confirm({
      title: 'Promote',
      message: t('skills.promoteConfirm', { name: slug }),
    });
    if (ok) await promote(slug).catch(() => {});
  };

  const enabledCount =
    labelSkills.filter((s) => s.enabled).length +
    materialSkills.filter((s) => s.enabled).length;
  const total = labelSkills.length + materialSkills.length;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">{t('skills.heading')}</div>
        <span className="text-[10px] text-zinc-600">
          [{enabledCount}/{total}]
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-2 p-1.5 rounded bg-status-error/10 border border-status-error/40 text-status-error text-[10px] flex items-center gap-2"
        >
          <span className="flex-1">⚠ {error}</span>
          <button type="button" aria-label={t('skills.dismissError')} onClick={clearError} className="hover:text-white">
            ×
          </button>
        </div>
      )}

      {needsFsWarning && (
        <div
          role="alert"
          className="mb-2 p-1.5 rounded border border-status-connecting/40 text-[10px] text-status-connecting"
        >
          {t('skills.fsMcpOffWarning')}
        </div>
      )}

      <div className="space-y-1">
        {labelSkills.map((skill, i) => (
          <div
            key={`label-${i}-${skill.name}`}
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
            <span className="truncate">
              <span className="text-zinc-600 mr-1">[{t('skills.labelBadge')}]</span>
              {skill.name}
            </span>
            <div className="hidden group-hover:flex gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditLabel(i, skill.name);
                }}
                aria-label={`Edit ${skill.name}`}
                className="hover:text-white"
              >
                ✎
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveLabel(i, skill.name);
                }}
                aria-label={`Remove ${skill.name}`}
                className="hover:text-status-error"
              >
                ×
              </button>
            </div>
          </div>
        ))}

        {materialSkills.map((skill) => (
          <div
            key={`material-${skill.name}`}
            data-skill-row
            className={`group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono ${
              skill.invalid
                ? 'text-status-error'
                : skill.enabled
                  ? 'text-zinc-400'
                  : 'text-zinc-600'
            }`}
          >
            <button
              type="button"
              disabled={!!skill.invalid}
              onClick={() => toggleEnabled(skill.name).catch(() => {})}
              aria-pressed={skill.enabled}
              aria-label={`${t('skills.enable')} ${skill.name}`}
              className="flex-1 text-left truncate disabled:cursor-not-allowed"
              title={skill.invalid ?? skill.description}
            >
              <span className="text-zinc-600 mr-1">
                [{skill.invalid ? t('skills.invalidBadge') : t('skills.materialBadge')}]
              </span>
              <span className={skill.enabled && !skill.invalid ? '' : 'line-through opacity-60'}>
                {skill.name}
              </span>
            </button>
            {!skill.invalid && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => togglePinned(skill.name).catch(() => {})}
                  aria-pressed={skill.pinned}
                  aria-label={`${t('skills.pin')} ${skill.name}`}
                  className={skill.pinned ? 'text-manipulation' : 'text-zinc-600 hover:text-zinc-300'}
                  title={t('skills.pin')}
                >
                  📌
                </button>
                <button
                  onClick={() => handleRemoveMaterial(skill.name)}
                  aria-label={`${t('skills.remove')} ${skill.name}`}
                  className="hover:text-status-error"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        ))}

        {labelSkills.length === 0 && materialSkills.length === 0 && (
          <p className="text-[10px] text-zinc-600">{t('skills.empty')}</p>
        )}

        <button
          onClick={handleAdd}
          aria-label="Add skill"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + Deploy New Skill
        </button>
        <button
          onClick={() => openCreateWithAi()}
          aria-label={t('skills.createWithAi')}
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-manipulation transition-colors mt-1"
        >
          ✨ {t('skills.createWithAi')}
        </button>
      </div>

      {drafts.length > 0 && (
        <div className="mt-3">
          <div className="mono-label mb-1">{t('skills.drafts')}</div>
          <div className="space-y-1">
            {drafts.map((d) => (
              <div
                key={`draft-${d.name}`}
                className="flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-dashed border-border-subtle text-[10px] font-mono text-zinc-500"
              >
                <span className="truncate" title={d.invalid ?? d.description}>
                  {d.name}
                </span>
                <button
                  disabled={!!d.invalid}
                  onClick={() => handlePromote(d.name)}
                  className="text-manipulation hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  {t('skills.promote')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
