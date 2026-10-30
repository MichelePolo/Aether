import { useState, useEffect } from 'react';
import { useContextStore } from '@/src/stores/context.store';
import { useMarkdownElements } from '@/src/lib/markdown/elements';
import { MarkdownEditor } from '@/src/components/markdown/MarkdownEditor';

const LABEL = 'System instruction';

export function SystemProtocolSection() {
  const systemInstruction = useContextStore((s) => s.context?.systemInstruction ?? '');
  const setSystemInstruction = useContextStore((s) => s.setSystemInstruction);
  const editorReady = useMarkdownElements();

  const commit = (value: string) => {
    if (value !== systemInstruction) setSystemInstruction(value).catch(() => {});
  };

  return (
    <section>
      {editorReady ? (
        // The sidebar is too narrow for side-by-side panes: start in Write,
        // the toolbar switches to Preview or Split.
        <MarkdownEditor
          value={systemInstruction}
          label={LABEL}
          onCommit={commit}
          view="write"
          className="aether-md-editor text-xs"
          style={{ blockSize: '18rem' }}
        />
      ) : (
        <PlainEditor value={systemInstruction} onCommit={commit} />
      )}
    </section>
  );
}

/** Shown while the editor element loads, or if it can't be loaded. */
function PlainEditor({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <textarea
      aria-label={LABEL}
      className="w-full bg-zinc-900/50 border border-border-subtle rounded p-2 text-xs font-mono text-zinc-400 focus:border-disclosure outline-none min-h-[120px] resize-none"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(local)}
    />
  );
}
