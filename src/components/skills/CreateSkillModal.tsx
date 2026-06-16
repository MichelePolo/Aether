import { useState } from 'react';
import { Modal } from '@/src/components/ui/Modal';
import { useUiStore } from '@/src/stores/ui.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { createSkillFlow } from '@/src/lib/skills/createSkillFlow';
import { t } from '@/src/i18n/t';

export function CreateSkillModal() {
  const open = useUiStore((s) => s.creatingSkill);
  const close = useUiStore((s) => s.closeCreatingSkill);
  const providers = useProvidersStore((s) => s.list);
  const defaultProvider = useProvidersStore((s) => s.defaultProvider);
  const [providerName, setProviderName] = useState<string>('');
  const [idea, setIdea] = useState('');

  const selected = providerName || defaultProvider || providers[0]?.name || '';

  const start = async () => {
    if (!selected) return;
    close();
    await createSkillFlow({ providerName: selected, idea }).catch(() => {});
    setIdea('');
    setProviderName('');
  };

  return (
    <Modal open={open} onClose={close} title={t('skills.createTitle')} className="max-w-sm">
      <div className="space-y-3">
        <label className="block text-[11px] text-zinc-400">
          {t('skills.createModel')}
          <select
            value={selected}
            onChange={(e) => setProviderName(e.target.value)}
            className="mt-1 w-full bg-zinc-900 border border-border-subtle rounded p-1 text-[11px] text-zinc-300"
          >
            {providers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] text-zinc-400">
          {t('skills.createIdea')}
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder={t('skills.createIdeaPlaceholder')}
            rows={3}
            className="mt-1 w-full bg-zinc-900 border border-border-subtle rounded p-1 text-[11px] text-zinc-300 resize-none"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="text-[11px] text-zinc-400 hover:text-white px-2 py-1"
          >
            {t('skills.createCancel')}
          </button>
          <button
            type="button"
            onClick={start}
            disabled={!selected}
            className="text-[11px] text-manipulation hover:underline px-2 py-1 disabled:opacity-40"
          >
            {t('skills.createStart')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
