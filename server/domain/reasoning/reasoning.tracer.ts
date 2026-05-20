import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { SseEmitter } from '@/server/lib/sse';
import type { ReasoningStep, ReasoningStepType, ToolCallTrace } from './reasoning.types';

export interface TracerStepOpts<T> {
  type: ReasoningStepType;
  title: string;
  run: () => Promise<{
    content: string;
    tokens?: number;
    subAgent?: string;
    toolCall?: ToolCallTrace;
    result: T;
  }>;
}

export class ReasoningTracer {
  private readonly steps: ReasoningStep[] = [];

  constructor(private readonly sse: SseEmitter) {}

  async step<T>(opts: TracerStepOpts<T>): Promise<T> {
    const t0 = performance.now();
    const { content, tokens, subAgent, toolCall, result } = await opts.run();
    const t1 = performance.now();
    const step: ReasoningStep = {
      id: randomUUID(),
      type: opts.type,
      title: opts.title,
      content,
      tokens,
      subAgent,
      toolCall,
      durationMs: Math.round(t1 - t0),
      timestamp: Date.now(),
    };
    this.steps.push(step);
    this.sse.event('reasoning_step', step);
    return result;
  }

  pushExternal(partial: Omit<ReasoningStep, 'id' | 'timestamp'>): void {
    const step: ReasoningStep = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...partial,
    };
    this.steps.push(step);
    this.sse.event('reasoning_step', step);
  }

  finalSteps(): ReasoningStep[] {
    return [...this.steps];
  }
}
