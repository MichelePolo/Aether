import { useMemo } from 'react';
import { Copy } from 'lucide-react';

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

function unifiedDiffText(lines: Line[]): string {
  return lines
    .map((l) => (l.kind === 'add' ? '+ ' : l.kind === 'remove' ? '- ' : '  ') + l.text)
    .join('\n');
}

export interface DiffViewProps { oldText: string; newText: string; path: string }

export function DiffView({ oldText, newText, path }: DiffViewProps) {
  const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText]);

  return (
    <div className="border border-border-subtle rounded text-[11px] font-mono bg-zinc-950">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border-subtle">
        <span className="text-zinc-500 text-[10px] flex-1 truncate">{path}</span>
        <button
          type="button"
          aria-label="Copy new text"
          onClick={() => void navigator.clipboard?.writeText(newText)}
          className="text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
        >
          <Copy size={10} aria-hidden="true" /> new
        </button>
        <button
          type="button"
          aria-label="Copy unified diff"
          onClick={() => void navigator.clipboard?.writeText(unifiedDiffText(lines))}
          className="text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
        >
          <Copy size={10} aria-hidden="true" /> diff
        </button>
      </div>
      <pre tabIndex={0} className="p-0 overflow-x-auto m-0">
        {lines.map((l, idx) => (
          <div
            key={idx}
            data-diff={l.kind}
            className={
              'flex ' + (
                l.kind === 'add' ? 'bg-emerald-950/40' :
                l.kind === 'remove' ? 'bg-rose-950/40' :
                ''
              )
            }
          >
            <span aria-hidden="true" className="select-none w-8 text-right pr-1 text-zinc-700 border-r border-border-subtle/40 mr-2">
              {idx + 1}
            </span>
            <span className={
              l.kind === 'add' ? 'text-emerald-400' :
              l.kind === 'remove' ? 'text-rose-400' :
              'text-zinc-400'
            }>
              <span aria-hidden="true">{l.kind === 'add' ? '+ ' : l.kind === 'remove' ? '- ' : '  '}</span>
              {l.text}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
