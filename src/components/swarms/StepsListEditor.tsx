import type { SwarmStep } from '@/src/lib/api/swarms.api';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useProvidersStore } from '@/src/stores/providers.store';

export function StepsListEditor({
  steps,
  onChange,
}: {
  steps: SwarmStep[];
  onChange: (steps: SwarmStep[]) => void;
}) {
  const subAgents = useSubAgentsStore((s) => s.list);
  const providers = useProvidersStore((s) => s.list);

  const update = (i: number, patch: Partial<SwarmStep>) =>
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () =>
    onChange([...steps, { subAgentName: subAgents[0]?.name ?? '', promptTemplate: '', pauseAfter: false }]);

  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, i) => (
        <div key={i} className="rounded border border-border-subtle bg-surface-1 p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500">{i + 1}</span>
            <select
              className="flex-1 bg-surface-2 border border-border-subtle rounded px-2 py-1 text-xs text-zinc-100"
              value={step.subAgentName}
              onChange={(e) => update(i, { subAgentName: e.target.value })}
            >
              {subAgents.map((sa) => (
                <option key={sa.id} value={sa.name}>
                  {sa.name}
                </option>
              ))}
            </select>
            <select
              className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-xs text-zinc-100"
              value={step.providerName ?? ''}
              onChange={(e) => update(i, { providerName: e.target.value || undefined })}
              title="Model for this step"
            >
              <option value="">Inherit</option>
              {step.providerName && !providers.some((p) => p.name === step.providerName) && (
                <option value={step.providerName}>{step.providerName} (unavailable)</option>
              )}
              {providers.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <button className="text-zinc-500 hover:text-manipulation text-xs" onClick={() => move(i, -1)}>↑</button>
            <button className="text-zinc-500 hover:text-manipulation text-xs" onClick={() => move(i, 1)}>↓</button>
            <button className="text-zinc-500 hover:text-status-error text-xs" onClick={() => remove(i)}>✕</button>
          </div>
          <textarea
            className="w-full bg-surface-2 border border-border-subtle rounded px-2 py-1 text-xs text-zinc-100"
            rows={2}
            placeholder="Prompt template (optional, prefixed to the previous step's output)"
            value={step.promptTemplate}
            onChange={(e) => update(i, { promptTemplate: e.target.value })}
          />
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input type="checkbox" checked={step.pauseAfter} onChange={(e) => update(i, { pauseAfter: e.target.checked })} />
            Pause for approval after this step
          </label>
        </div>
      ))}
      <button className="self-start text-xs text-manipulation hover:underline" onClick={add}>
        + Add step
      </button>
    </div>
  );
}
