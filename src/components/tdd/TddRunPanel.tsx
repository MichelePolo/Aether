import { useTddRun } from '@/src/hooks/useTddRun';

export function TddRunPanel({
  command,
  subAgentName,
  maxRetries,
}: {
  command: string;
  subAgentName: string;
  maxRetries: number;
}) {
  const { state, run, cancel } = useTddRun();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          className="px-3 py-1.5 rounded bg-manipulation text-black hover:bg-manipulation/90 disabled:opacity-40"
          disabled={state.running}
          onClick={() => run({ command, subAgentName, maxRetries })}
        >
          Run
        </button>
        {state.running && (
          <button className="px-2 py-1 rounded bg-status-error/20 text-status-error text-xs" onClick={cancel}>
            Cancel
          </button>
        )}
        <span className="text-[11px] text-zinc-500 font-mono truncate">{command}</span>
      </div>

      <ol className="flex flex-col gap-2">
        {state.results.map((r) => (
          <li key={r.iteration} className="rounded border border-border-subtle bg-surface-1 p-2">
            <div className={`text-[10px] uppercase tracking-widest ${r.passed ? 'text-status-online' : 'text-status-error'}`}>
              {r.iteration === 0 ? 'initial' : `iteration ${r.iteration}`} — {r.passed ? 'pass' : `fail (exit ${r.exitCode})`}
            </div>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-zinc-400">{r.output}</pre>
          </li>
        ))}
      </ol>

      {state.error && <div className="text-xs text-status-error">{state.error}</div>}
      {state.status && <div className="text-xs text-zinc-400">Status: {state.status}</div>}
    </div>
  );
}
