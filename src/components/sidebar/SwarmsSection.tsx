import { useState } from 'react';
import { useSwarmsStore } from '@/src/stores/swarms.store';
import { SwarmEditModal } from '@/src/components/swarms/SwarmEditModal';
import { SwarmRunPanel } from '@/src/components/swarms/SwarmRunPanel';

export function SwarmsSection() {
  const swarms = useSwarmsStore((s) => s.list);
  const remove = useSwarmsStore((s) => s.remove);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Swarms</span>
        <button className="text-[10px] text-manipulation hover:underline" onClick={() => setEditing('new')}>
          + New
        </button>
      </div>
      {swarms.map((sw) => (
        <div key={sw.id} className="flex items-center justify-between rounded bg-surface-1 p-1.5 text-[11px]">
          <button className="text-zinc-200 hover:text-manipulation" onClick={() => setRunning(sw.id)}>
            {sw.name} <span className="text-zinc-500">({sw.stepCount})</span>
          </button>
          <div className="flex gap-1.5">
            <button className="text-zinc-500 hover:text-manipulation" onClick={() => setEditing(sw.id)}>edit</button>
            <button className="text-zinc-500 hover:text-status-error" onClick={() => void remove(sw.id)}>del</button>
          </div>
        </div>
      ))}
      {editing && <SwarmEditModal id={editing} onClose={() => setEditing(null)} />}
      {running && (
        <div className="mt-2 rounded border border-border-subtle">
          <SwarmRunPanel swarmId={running} />
        </div>
      )}
    </div>
  );
}
