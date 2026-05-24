import { useMemo } from 'react';

interface Line { kind: 'same' | 'add' | 'remove'; text: string }

function diffLines(oldText: string, newText: string): Line[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const out: Line[] = [];
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    const a = oldLines[i];
    const b = newLines[j];
    if (i >= oldLines.length) { out.push({ kind: 'add', text: b ?? '' }); j++; continue; }
    if (j >= newLines.length) { out.push({ kind: 'remove', text: a ?? '' }); i++; continue; }
    if (a === b) { out.push({ kind: 'same', text: a }); i++; j++; continue; }
    if (oldLines[i] === newLines[j + 1]) { out.push({ kind: 'add', text: b }); j++; continue; }
    if (newLines[j] === oldLines[i + 1]) { out.push({ kind: 'remove', text: a }); i++; continue; }
    out.push({ kind: 'remove', text: a }); i++;
    out.push({ kind: 'add', text: b }); j++;
  }
  return out;
}

export interface DiffViewProps { oldText: string; newText: string; path: string }

export function DiffView({ oldText, newText, path }: DiffViewProps) {
  const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  return (
    <div className="border border-border-subtle rounded text-[11px] font-mono bg-zinc-950">
      <div className="px-2 py-1 text-zinc-500 text-[10px] border-b border-border-subtle">{path}</div>
      <pre className="p-2 overflow-x-auto">
        {lines.map((l, idx) => (
          <div
            key={idx}
            data-diff={l.kind}
            className={
              l.kind === 'add'
                ? 'text-emerald-400'
                : l.kind === 'remove'
                ? 'text-rose-400'
                : 'text-zinc-400'
            }
          >
            <span aria-hidden>{l.kind === 'add' ? '+ ' : l.kind === 'remove' ? '- ' : '  '}</span>
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
