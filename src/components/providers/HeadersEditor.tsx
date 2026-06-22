import { X, Plus } from 'lucide-react';

interface HeadersEditorProps {
  value: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
}

export function HeadersEditor({ value, onChange }: HeadersEditorProps) {
  const entries = Object.entries(value);

  const handleKeyChange = (oldKey: string, newKey: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(next);
  };

  const handleValueChange = (key: string, newValue: string) => {
    onChange({ ...value, [key]: newValue });
  };

  const handleRemove = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  const handleAdd = () => {
    let key = 'Header';
    let n = 1;
    while (key in value) {
      key = `Header${n++}`;
    }
    onChange({ ...value, [key]: '' });
  };

  return (
    <div className="flex flex-col gap-1">
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-1">
          <input
            aria-label={`Header key ${key}`}
            placeholder="Key"
            value={key}
            onChange={(e) => handleKeyChange(key, e.target.value)}
            className="flex-1 bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600"
          />
          <input
            aria-label={`Header value ${key}`}
            placeholder="Value"
            value={val}
            onChange={(e) => handleValueChange(key, e.target.value)}
            className="flex-1 bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            type="button"
            aria-label={`Remove header ${key}`}
            onClick={() => handleRemove(key)}
            className="px-1.5 py-1 rounded text-zinc-400 hover:text-white border border-border-subtle"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ))}
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
