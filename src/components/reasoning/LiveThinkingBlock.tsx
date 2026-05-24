export interface LiveThinkingBlockProps {
  text: string;
}

export function LiveThinkingBlock({ text }: LiveThinkingBlockProps) {
  if (!text) return null;
  return (
    <div className="p-2 rounded bg-purple-500/5 border border-purple-500/30" aria-live="polite">
      <div className="mono-label text-purple-300 mb-1">
        <span aria-hidden="true">💭 </span>thinking
      </div>
      <div className="text-[11px] text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
        {text}
      </div>
    </div>
  );
}
