export interface DispatchBranchProps {
  subAgent?: string;
}

export function DispatchBranch({ subAgent }: DispatchBranchProps) {
  if (!subAgent) return null;
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 font-mono uppercase tracking-widest">
      {subAgent}
    </span>
  );
}
