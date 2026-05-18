export interface ConfidenceBarProps {
  confidence?: number;
}

export function ConfidenceBar({ confidence }: ConfidenceBarProps) {
  if (confidence === undefined) return null;
  const clamped = Math.max(0, Math.min(1, confidence));
  const pct = `${Math.round(clamped * 100)}%`;
  return (
    <div className="h-1 w-full bg-zinc-800 rounded overflow-hidden">
      <div
        data-testid="confidence-fill"
        className="h-full bg-accent"
        style={{ width: pct }}
      />
    </div>
  );
}
