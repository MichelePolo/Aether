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

  useEffect(() => {
    if (id !== 'new') {
      void swarmsApi.get(id).then((rec) => {
        setName(rec.name);
        setSteps(rec.steps);
      });
    }
  }, [id]);

  const save = async () => {
    if (id === 'new') await createSwarm({ name, steps });
    else await updateSwarm(id, { name, steps });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={id === 'new' ? 'New swarm' : 'Edit swarm'}>
      <div className="flex flex-col gap-3">
        <input
          className="w-full bg-surface-2 border border-border-subtle rounded px-2 py-1.5 text-sm text-white"
          placeholder="Swarm name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <StepsListEditor steps={steps} onChange={setSteps} />
        <button
          className="self-end px-3 py-1.5 rounded bg-manipulation text-black hover:bg-manipulation/90 disabled:opacity-40"
          disabled={name.trim().length === 0 || steps.length === 0}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
