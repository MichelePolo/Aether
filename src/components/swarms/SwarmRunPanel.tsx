import { useState } from 'react';
import { useSwarmRun } from '@/src/hooks/useSwarmRun';
import { t } from '@/src/i18n/t';

export function SwarmRunPanel({ swarmId }: { swarmId: string }) {
  const { state, run, approve, reject } = useSwarmRun();
  const [input, setInput] = useState('');

  return (
    <div className="flex flex-col gap-3 p-3">
      <textarea
        className="w-full bg-surface-2 border border-border-subtle rounded p-2 text-sm text-zinc-100"
        rows={3}
        placeholder="Initial input for the swarm…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={state.running}
      />
      <button
        className="self-start px-3 py-1.5 rounded bg-manipulation text-black hover:bg-manipulation/90 disabled:opacity-40"
        disabled={state.running || input.trim().length === 0}
        onClick={() => run(swarmId, input)}
      >
        Run swarm
      </button>

      <ol className="flex flex-col gap-2">
        {state.steps.map((st) => (
          <li key={st.position} className="rounded border border-border-subtle bg-surface-1 p-2">
            <div className="text-[10px] uppercase tracking-widest text-manipulation">
              {st.position + 1}. {st.subAgent} — {st.status}
            </div>
            {st.output && <pre className="mt-1 whitespace-pre-wrap text-xs text-zinc-300">{st.output}</pre>}
            {st.warning && (
              <div className="text-[11px] text-amber-400">
                {t('swarms.stepWarning', { requested: st.warning.requested ?? '—', used: st.warning.used ?? 'default' })}
              </div>
            )}
          </li>
        ))}
      </ol>

      {state.pending && (
        <div className="rounded border border-manipulation/40 bg-surface-2 p-2">
          <div className="text-xs text-zinc-200">Approve step {state.pending.position + 1} output?</div>
          <div className="mt-2 flex gap-2">
            <button
              className="px-2 py-1 rounded bg-manipulation text-black text-xs"
              onClick={() => approve(state.pending!.approvalId)}
            >
              Approve
            </button>
            <button
              className="px-2 py-1 rounded bg-status-error/20 text-status-error text-xs"
              onClick={() => reject(state.pending!.approvalId)}
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {state.error && <div className="text-xs text-status-error">{state.error}</div>}
      {state.status && <div className="text-xs text-zinc-400">Status: {state.status}</div>}
    </div>
  );
}
