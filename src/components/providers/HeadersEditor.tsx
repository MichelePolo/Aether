import { useEffect, useRef, useState } from 'react';
import { X, Plus } from 'lucide-react';

interface HeadersEditorProps {
  value: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
}

/** One editable row. `id` is stable for the row's whole life so React never
 *  remounts an input while its header name is being typed. */
interface Row {
  id: number;
  key: string;
  value: string;
}

function toRows(record: Record<string, string>, seed: number): Row[] {
  return Object.entries(record).map(([key, value], i) => ({ id: seed + i, key, value }));
}

function toRecord(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    // A half-typed row with no name yet stays visible but is not emitted.
    if (row.key !== '') out[row.key] = row.value;
  }
  return out;
}

function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/**
 * Key/value editor for custom HTTP headers.
 *
 * Rows are keyed by a generated id rather than by the header name: the name is
 * itself editable, so keying by it made React discard and recreate the input on
 * every keystroke, and the field lost focus after each character.
 */
export function HeadersEditor({ value, onChange }: HeadersEditorProps) {
  const nextId = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => {
    const initial = toRows(value, nextId.current);
    nextId.current += initial.length;
    return initial;
  });
  /** The record this component last produced, to tell our own echo apart from
   *  a genuine external replacement (e.g. the parent form resetting to {}). */
  const lastEmitted = useRef<Record<string, string>>(value);

  useEffect(() => {
    if (value === lastEmitted.current || sameRecord(value, lastEmitted.current)) return;
    const next = toRows(value, nextId.current);
    nextId.current += next.length;
    lastEmitted.current = value;
    setRows(next);
  }, [value]);

  const commit = (next: Row[]): void => {
    setRows(next);
    const record = toRecord(next);
    lastEmitted.current = record;
    onChange(record);
  };

  const handleKeyChange = (id: number, newKey: string): void => {
    commit(rows.map((r) => (r.id === id ? { ...r, key: newKey } : r)));
  };

  const handleValueChange = (id: number, newValue: string): void => {
    commit(rows.map((r) => (r.id === id ? { ...r, value: newValue } : r)));
  };

  const handleRemove = (id: number): void => {
    commit(rows.filter((r) => r.id !== id));
  };

  const handleAdd = (): void => {
    const id = nextId.current++;
    commit([...rows, { id, key: '', value: '' }]);
  };

  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => {
        const label = row.key === '' ? '(new)' : row.key;
        return (
          <div key={row.id} className="flex items-center gap-1">
            <input
              aria-label={`Header key ${label}`}
              placeholder="Key"
              value={row.key}
              onChange={(e) => handleKeyChange(row.id, e.target.value)}
              className="flex-1 bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600"
            />
            <input
              aria-label={`Header value ${label}`}
              placeholder="Value"
              value={row.value}
              onChange={(e) => handleValueChange(row.id, e.target.value)}
              className="flex-1 bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600"
            />
            <button
              type="button"
              aria-label={`Remove header ${label}`}
              onClick={() => handleRemove(row.id)}
              className="px-1.5 py-1 rounded text-zinc-400 hover:text-white border border-border-subtle"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label="Add header"
        onClick={handleAdd}
        className="self-start flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-zinc-400 hover:text-white border border-border-subtle"
      >
        <Plus size={10} aria-hidden="true" />
        Add header
      </button>
    </div>
  );
}
