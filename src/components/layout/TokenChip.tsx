import { useShallow } from 'zustand/react/shallow';
import { useChatStore, contextSizeOfActive } from '@/src/stores/chat.store';

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function TokenChip() {
  const ctx = useChatStore(useShallow(contextSizeOfActive));
  if (!ctx) return null;
  const tooltip = `prompt ${ctx.prompt} / reply ${ctx.reply}`;
  return (
    <span
      data-testid="token-chip"
      title={tooltip}
      className="text-[10px] font-mono text-zinc-400 px-2 py-1 rounded border border-border-subtle bg-surface-3"
    >
      ▵ {formatTokens(ctx.total)} tok
    </span>
  );
}
