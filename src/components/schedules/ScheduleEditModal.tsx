import { useState } from 'react';
import { Modal } from '@/src/components/ui/Modal';
import { Button } from '@/src/components/ui/Button';
import { useSchedulesStore } from '@/src/stores/schedules.store';
import { useSwarmsStore } from '@/src/stores/swarms.store';
import type { Cadence, Target } from '@/src/lib/api/schedules.api';

export function ScheduleEditModal({ id, onClose }: { id: string | 'new'; onClose: () => void }) {
  const existing = useSchedulesStore((s) => (id === 'new' ? undefined : s.list.find((x) => x.id === id)));
  const create = useSchedulesStore((s) => s.create);
  const update = useSchedulesStore((s) => s.update);
  const swarms = useSwarmsStore((s) => s.list);

  const [name, setName] = useState(existing?.name ?? '');
  const [cronExpr, setCronExpr] = useState(existing?.cadence.kind === 'cron' ? existing.cadence.expr : '0 3 * * *');
  const [cadenceKind, setCadenceKind] = useState<Cadence['kind']>(existing?.cadence.kind ?? 'cron');
  const [everyMin, setEveryMin] = useState(existing?.cadence.kind === 'interval' ? Math.round(existing.cadence.everyMs / 60_000) : 60);
  const [targetKind, setTargetKind] = useState<Target['kind']>(existing?.target.kind ?? 'prompt');
  const [prompt, setPrompt] = useState(existing?.target.kind === 'prompt' ? existing.target.prompt : '');
  const [subAgent, setSubAgent] = useState(existing?.target.kind === 'prompt' ? (existing.target.subAgent ?? '') : '');
  const [swarmId, setSwarmId] = useState(existing?.target.kind === 'swarm' ? existing.target.swarmId : (swarms[0]?.id ?? ''));
  const [autonomy, setAutonomy] = useState<'safe' | 'trusted'>(existing?.autonomy ?? 'safe');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  const cadence: Cadence = cadenceKind === 'cron' ? { kind: 'cron', expr: cronExpr } : { kind: 'interval', everyMs: everyMin * 60_000 };
  const target: Target = targetKind === 'prompt'
    ? { kind: 'prompt', prompt, ...(subAgent ? { subAgent } : {}) }
    : { kind: 'swarm', swarmId };
  const valid = name.trim() && (targetKind === 'prompt' ? prompt.trim() : swarmId);

  const save = async () => {
    const input = { name, cadence, target, autonomy, enabled };
    if (id === 'new') await create(input); else await update(id, input);
    onClose();
  };

  return (
    <Modal open onClose={onClose} className="max-w-md">
      <h2 className="mono-label mb-3">{id === 'new' ? 'New schedule' : 'Edit schedule'}</h2>
      <div className="space-y-3 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" className="w-full rounded border border-border-subtle bg-surface-0 p-2" />
        <div className="flex gap-2">
          <select value={cadenceKind} onChange={(e) => setCadenceKind(e.target.value as Cadence['kind'])} aria-label="Cadence kind" className="rounded border border-border-subtle bg-surface-0 p-2">
            <option value="cron">cron</option><option value="interval">interval</option>
          </select>
          {cadenceKind === 'cron'
            ? <input value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} aria-label="Cron expression" placeholder="0 3 * * *" className="flex-1 rounded border border-border-subtle bg-surface-0 p-2 font-mono" />
            : <input type="number" min={1} value={everyMin} onChange={(e) => setEveryMin(Number(e.target.value))} aria-label="Every minutes" className="flex-1 rounded border border-border-subtle bg-surface-0 p-2" />}
        </div>
        <div className="flex gap-2">
          <select value={targetKind} onChange={(e) => setTargetKind(e.target.value as Target['kind'])} aria-label="Target kind" className="rounded border border-border-subtle bg-surface-0 p-2">
            <option value="prompt">prompt</option><option value="swarm">swarm</option>
          </select>
          {targetKind === 'prompt'
            ? <input value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Prompt" placeholder="Prompt" className="flex-1 rounded border border-border-subtle bg-surface-0 p-2" />
            : <select value={swarmId} onChange={(e) => setSwarmId(e.target.value)} aria-label="Swarm" className="flex-1 rounded border border-border-subtle bg-surface-0 p-2">
                {swarms.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>}
        </div>
        {targetKind === 'prompt' && (
          <input value={subAgent} onChange={(e) => setSubAgent(e.target.value)} aria-label="Sub-agent (optional)" placeholder="@subagent (optional)" className="w-full rounded border border-border-subtle bg-surface-0 p-2" />
        )}
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={autonomy === 'trusted'} onChange={(e) => setAutonomy(e.target.checked ? 'trusted' : 'safe')} aria-label="Trusted" />
          Trusted (auto-approve ALL tool calls — incl. dangerous). Default safe rejects gated tools.
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label="Enabled" /> Enabled
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!valid} onClick={() => void save()}>Save</Button>
      </div>
    </Modal>
  );
}
