import type { ReasoningStep, ReasoningStepType } from '@/src/types/reasoning.types';
import { ConfidenceBar } from './ConfidenceBar';
import { DispatchBranch } from './DispatchBranch';
import { cn } from '@/src/lib/cn';

const TYPE_LABELS: Record<ReasoningStepType, string> = {
  context_fetch: 'context',
  mcp_query: 'mcp',
  dispatch: 'dispatch',
  thinking: 'thinking',
  validation: 'validation',
  logic: 'logic',
  resolve_subagent: 'subagent',
};

const TYPE_COLORS: Record<ReasoningStepType, string> = {
  context_fetch: 'bg-blue-500/10 text-blue-400',
  mcp_query: 'bg-cyan-500/10 text-cyan-400',
  dispatch: 'bg-purple-500/10 text-purple-400',
  thinking: 'bg-purple-500/10 text-purple-300',
  validation: 'bg-green-500/10 text-green-400',
  logic: 'bg-zinc-800 text-zinc-400',
  resolve_subagent: 'bg-amber-500/10 text-amber-400',
};

function formatDuration(ms?: number): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(tokens?: number): string {
  return tokens === undefined ? '—' : `${tokens}`;
}

export interface ReasoningStepCardProps {
  step: ReasoningStep;
}

export function ReasoningStepCard({ step }: ReasoningStepCardProps) {
  const knownType = step.type in TYPE_LABELS ? step.type : 'logic';
  const badgeLabel = TYPE_LABELS[knownType as ReasoningStepType] ?? step.type;
  const badgeColor = TYPE_COLORS[knownType as ReasoningStepType] ?? TYPE_COLORS.logic;

  return (
    <div className="p-2 rounded bg-surface-3 border border-border-subtle">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-widest font-bold', badgeColor)}>
          {badgeLabel}
        </span>
        <DispatchBranch subAgent={step.subAgent} />
      </div>
      <div className="text-xs font-mono text-zinc-200 mb-1">{step.title}</div>
      <div className="text-[11px] text-zinc-400 whitespace-pre-wrap mb-2">{step.content}</div>
      <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
        <span>{formatDuration(step.durationMs)}</span>
        <span>{formatTokens(step.tokens)} t</span>
      </div>
      <ConfidenceBar />
    </div>
  );
}
