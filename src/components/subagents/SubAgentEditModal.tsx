import { useEffect, useState } from 'react';
import { Modal } from '@/src/components/ui/Modal';
import { useUiStore } from '@/src/stores/ui.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useDialog } from '@/src/hooks/useDialog';
import { subagentsApi } from '@/src/lib/api/subagents.api';
import type { SubAgentRecord } from '@/src/types/subagent.types';
import type { Tool } from '@/src/types/context.types';
import { t } from '@/src/i18n/t';
import { SkillsListEditor } from './SkillsListEditor';
import { ToolsListEditor } from './ToolsListEditor';

type FullRecord = SubAgentRecord & { id: string };

export function SubAgentEditModal() {
  const id = useUiStore((s) => s.editingSubAgentId);
  const close = useUiStore((s) => s.closeSubAgentEditor);
  const update = useSubAgentsStore((s) => s.update);
  const error = useSubAgentsStore((s) => s.error);
  const clearError = useSubAgentsStore((s) => s.clearError);
  const providers = useProvidersStore((s) => s.list);
  const dialog = useDialog();

  const [record, setRecord] = useState<FullRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setRecord(null);
      setLoadError(null);
      return;
    }
    setRecord(null);
    setLoadError(null);
    subagentsApi
      .get(id)
      .then(setRecord)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);

  if (!id) return null;

  const persist = async (partial: Partial<SubAgentRecord>) => {
    if (!record) return;
    const prev = record;
    setRecord({ ...record, ...partial });
    try {
      await update(id, partial);
    } catch {
      setRecord(prev);
    }
  };

  const handleRename = async () => {
    if (!record) return;
    const name = await dialog.prompt({
      title: 'Rename sub-agent',
      label: 'Name',
      defaultValue: record.name,
      required: true,
    });
    if (name) await persist({ name });
  };

  const handleEditSystem = async () => {
    if (!record) return;
    const text = await dialog.prompt({
      title: 'Update instruction',
      label: 'System instruction',
      defaultValue: record.systemInstruction,
      multiline: true,
    });
    if (text !== null) await persist({ systemInstruction: text });
  };

  return (
    <Modal open onClose={close} title="Edit Sub-agent" className="max-w-2xl">
      {loadError ? (
        <div className="p-2 rounded bg-status-error/10 border border-status-error/40 text-status-error text-xs">
          Failed to load: {loadError}
        </div>
      ) : record === null ? (
        <div className="text-xs text-zinc-500 italic">Loading…</div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="p-1.5 rounded bg-status-error/10 border border-status-error/40 text-status-error text-[10px] flex items-center gap-2">
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

          <section>
            <div className="flex items-center justify-between mb-1">
              <div className="mono-label">Name</div>
              <button
                type="button"
                onClick={handleRename}
                className="text-[10px] text-manipulation hover:text-white"
              >
                Rename
              </button>
            </div>
            <div className="p-1.5 rounded bg-zinc-900 border border-border-subtle text-xs font-mono text-zinc-300">
              {record.name}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-1">
              <div className="mono-label">System Instruction</div>
              <button
                type="button"
                onClick={handleEditSystem}
                className="text-[10px] text-manipulation hover:text-white"
              >
                Edit system instruction
              </button>
            </div>
            <pre className="p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono text-zinc-400 whitespace-pre-wrap min-h-[40px] max-h-[40vh] overflow-y-auto">
              {record.systemInstruction || <span className="italic text-zinc-600">(empty)</span>}
            </pre>
          </section>

          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            {t('subagents.defaultModelLabel')}
            <select
              className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-xs text-zinc-100"
              value={record.model ?? ''}
              onChange={(e) => persist({ model: e.target.value })}
            >
              <option value="">{t('subagents.defaultModelNone')}</option>
              {record.model && !providers.some((p) => p.name === record.model) && (
                <option value={record.model}>{t('subagents.defaultModelUnavailable', { name: record.model })}</option>
              )}
              {providers.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </label>

          <SkillsListEditor
            skills={record.skills}
            onAdd={(name) => persist({ skills: [...record.skills, name] })}
            onRemove={(idx) =>
              persist({ skills: record.skills.filter((_, i) => i !== idx) })
            }
          />

          <ToolsListEditor
            tools={record.tools}
            onAdd={(tool: Tool) => persist({ tools: [...record.tools, tool] })}
            onRemove={(toolId) =>
              persist({ tools: record.tools.filter((t) => t.id !== toolId) })
            }
          />
        </div>
      )}
    </Modal>
  );
}
