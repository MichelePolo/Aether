import { useState } from 'react';
import { Modal } from '@/src/components/ui/Modal';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useTddUiStore } from '@/src/stores/tdd-ui.store';
import { TddRunPanel } from './TddRunPanel';

export function TddRunModal() {
  const open = useTddUiStore((s) => s.open);
  const close = useTddUiStore((s) => s.closeModal);
  const subAgents = useSubAgentsStore((s) => s.list);

  const [command, setCommand] = useState('npx vitest run');
  const [subAgentName, setSubAgentName] = useState('');
  const [maxRetries, setMaxRetries] = useState(5);
  const [started, setStarted] = useState(false);

  if (!open) return null;
  const fixer = subAgentName || subAgents[0]?.name || '';

  return (
    <Modal open onClose={close} title="Auto-fix tests">
      {subAgents.length === 0 ? (
        <div className="text-sm text-zinc-400">Create a sub-agent first to use as the fixer.</div>
      ) : !started ? (
        <div className="flex flex-col gap-3">
          <label className="text-[11px] text-zinc-400">Test command</label>
          <input
            className="w-full bg-surface-2 border border-border-subtle rounded px-2 py-1.5 text-sm text-white font-mono"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <label className="text-[11px] text-zinc-400">Fixer sub-agent</label>
          <select
            className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-sm text-zinc-100"
            value={fixer}
            onChange={(e) => setSubAgentName(e.target.value)}
          >
            {subAgents.map((sa) => (
              <option key={sa.id} value={sa.name}>{sa.name}</option>
            ))}
          </select>
          <label className="text-[11px] text-zinc-400">Max retries</label>
          <input
            type="number"
            min={1}
            max={20}
            className="w-24 bg-surface-2 border border-border-subtle rounded px-2 py-1 text-sm text-zinc-100"
            value={maxRetries}
            onChange={(e) => setMaxRetries(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          />
          <button
            className="self-end px-3 py-1.5 rounded bg-manipulation text-black hover:bg-manipulation/90 disabled:opacity-40"
            disabled={command.trim().length === 0 || !fixer}
            onClick={() => setStarted(true)}
          >
            Start
          </button>
        </div>
      ) : (
        <TddRunPanel command={command} subAgentName={fixer} maxRetries={maxRetries} />
      )}
    </Modal>
  );
}
