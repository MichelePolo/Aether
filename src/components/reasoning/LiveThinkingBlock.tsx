export interface LiveThinkingBlockProps {
  text: string;
}

export function LiveThinkingBlock({ text }: LiveThinkingBlockProps) {
  if (!text) return null;
  return (
    <div className="p-2 rounded bg-disclosure/5 border border-disclosure/30" aria-live="polite">
      <div className="mono-label text-disclosure mb-1">
        <span aria-hidden="true">💭 </span>thinking
      </div>
      <div className="text-[11px] text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
        {text}
      </div>
    </div>
  );
}
