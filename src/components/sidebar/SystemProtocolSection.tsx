import { useState, useEffect } from 'react';
import { useContextStore } from '@/src/stores/context.store';

export function SystemProtocolSection() {
  const systemInstruction = useContextStore((s) => s.context?.systemInstruction ?? '');
  const setSystemInstruction = useContextStore((s) => s.setSystemInstruction);

  const [local, setLocal] = useState(systemInstruction);

  useEffect(() => setLocal(systemInstruction), [systemInstruction]);

  return (
    <section>
      <textarea
        aria-label="System instruction"
        className="w-full bg-zinc-900/50 border border-border-subtle rounded p-2 text-xs font-mono text-zinc-400 focus:border-disclosure outline-none min-h-[120px] resize-none"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== systemInstruction) {
            setSystemInstruction(local).catch(() => {});
          }
        }}
      />
    </section>
  );
}
