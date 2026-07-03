import { useEffect, useState } from 'react';
import { Modal } from '@/src/components/ui/Modal';
import { useSwarmsStore } from '@/src/stores/swarms.store';
import { swarmsApi, type SwarmStep } from '@/src/lib/api/swarms.api';
import { StepsListEditor } from './StepsListEditor';

export function SwarmEditModal({ id, onClose }: { id: string | 'new'; onClose: () => void }) {
  const createSwarm = useSwarmsStore((s) => s.create);
  const updateSwarm = useSwarmsStore((s) => s.update);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<SwarmStep[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (id !== 'new') {
      setLoadError(null);
      void swarmsApi
        .get(id)
        .then((rec) => {
          setName(rec.name);
          setSteps(rec.steps);
        })
        .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load swarm'));
    }
  }, [id]);

  const save = async () => {
    if (id !== 'new' && loadError) return;
    if (id === 'new') await createSwarm({ name, steps });
    else await updateSwarm(id, { name, steps });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={id === 'new' ? 'New swarm' : 'Edit swarm'}>
      <div className="flex flex-col gap-3">
        {loadError && (
          <div className="text-xs text-red-400 border border-red-400/30 rounded px-2 py-1.5 bg-red-400/10">
            Failed to load swarm: {loadError}
          </div>
        )}
        <input
          className="w-full bg-surface-2 border border-border-subtle rounded px-2 py-1.5 text-sm text-white"
          placeholder="Swarm name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <StepsListEditor steps={steps} onChange={setSteps} />
        <button
          className="self-end px-3 py-1.5 rounded bg-manipulation text-black hover:bg-manipulation/90 disabled:opacity-40"
          disabled={name.trim().length === 0 || steps.length === 0 || (id !== 'new' && !!loadError)}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
