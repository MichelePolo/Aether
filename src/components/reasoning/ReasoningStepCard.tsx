import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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
  tool_call: 'tool',
};

const TYPE_COLORS: Record<ReasoningStepType, string> = {
  context_fetch: 'bg-disclosure/10 text-disclosure',
  mcp_query: 'bg-disclosure/10 text-disclosure',
  dispatch: 'bg-disclosure/10 text-disclosure',
  thinking: 'bg-disclosure/10 text-disclosure',
  validation: 'bg-status-online/10 text-status-online',
  logic: 'bg-zinc-800 text-zinc-400',
  resolve_subagent: 'bg-disclosure/10 text-disclosure',
  tool_call: 'bg-disclosure/10 text-disclosure',
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
  // Tool calls are noisy → collapsed by default; thinking/context steps stay
  // expanded by default. Every card is collapsible via its header.
  const [open, setOpen] = useState(step.type !== 'tool_call');
  const Chevron = open ? ChevronDown : ChevronRight;
  const hasError = Boolean(step.toolCall?.error);

  return (
    <div className="rounded bg-surface-3 border border-border-subtle glow-disc">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 p-2 text-left"
      >
        <Chevron size={12} aria-hidden="true" className="shrink-0 text-zinc-500" />
        <span className={cn('shrink-0 text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-widest font-bold', badgeColor)}>
          {badgeLabel}
        </span>
        <span className="flex-1 truncate text-xs font-mono text-zinc-200">{step.title}</span>
        {hasError && (
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-status-error" aria-label="tool error" />
        )}
        <DispatchBranch subAgent={step.subAgent} />
        <span className="shrink-0 text-[10px] text-zinc-500 font-mono">{formatDuration(step.durationMs)}</span>
        <span className="shrink-0 text-[10px] text-zinc-500 font-mono">{formatTokens(step.tokens)} t</span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          {step.content && (
            <div className="text-[11px] text-zinc-400 whitespace-pre-wrap mb-2">{step.content}</div>
          )}
          {step.toolCall && (
            <div className="mt-1 space-y-1 text-[10px] font-mono">
              {step.toolCall.progressNote && (
                <div className="italic text-zinc-500">{step.toolCall.progressNote}</div>
              )}
              <details>
                <summary className="cursor-pointer text-zinc-500">args</summary>
                <pre className="mt-1 p-1.5 rounded bg-zinc-900/60 text-zinc-300 overflow-x-auto">
                  {JSON.stringify(step.toolCall.args, null, 2)}
                </pre>
              </details>
              {step.toolCall.error ? (
                <div className="p-1.5 rounded bg-status-error/10 text-status-error">{step.toolCall.error}</div>
              ) : step.toolCall.result !== undefined ? (
                <details>
                  <summary className="cursor-pointer text-zinc-500">result</summary>
                  <pre className="mt-1 p-1.5 rounded bg-zinc-900/60 text-zinc-300 overflow-x-auto">
                    {JSON.stringify(step.toolCall.result, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          )}
          <ConfidenceBar />
        </div>
      )}
    </div>
  );
}
