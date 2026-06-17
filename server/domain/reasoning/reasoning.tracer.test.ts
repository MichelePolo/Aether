import { describe, it, expect } from 'vitest';
import { ReasoningTracer } from './reasoning.tracer';
import { createCollectorEmitter } from '@/server/test/sse-collector';

describe('ReasoningTracer.step', () => {
  it('emits a reasoning_step event with measured durationMs', async () => {
    const { emitter, events } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    const result = await tracer.step({
      type: 'context_fetch',
      title: 'Read context',
      run: async () => ({ content: 'done', result: 42 }),
    });
    expect(result).toBe(42);
    expect(events).toHaveLength(1);
    const step = events[0].data as { type: string; title: string; content: string; durationMs: number };
    expect(step.type).toBe('context_fetch');
    expect(step.title).toBe('Read context');
    expect(step.content).toBe('done');
    expect(typeof step.durationMs).toBe('number');
    expect(step.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures tokens when run() returns them', async () => {
    const { emitter, events } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    await tracer.step({
      type: 'dispatch',
      title: 'Dispatch',
      run: async () => ({ content: 'x', tokens: 1234, result: null }),
    });
    expect((events[0].data as { tokens?: number }).tokens).toBe(1234);
  });

  it('does NOT emit when run() rejects, and propagates the error', async () => {
    const { emitter, events } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    await expect(
      tracer.step({
        type: 'dispatch',
        title: 'Dispatch',
        run: async () => { throw new Error('boom'); },
      }),
    ).rejects.toThrow('boom');
    expect(events).toHaveLength(0);
    expect(tracer.finalSteps()).toHaveLength(0);
  });

  it('accumulates multiple steps in order', async () => {
    const { emitter } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    await tracer.step({ type: 'context_fetch', title: 'a', run: async () => ({ content: 'a', result: null }) });
    await tracer.step({ type: 'dispatch', title: 'b', run: async () => ({ content: 'b', result: null }) });
    const steps = tracer.finalSteps();
    expect(steps.map((s) => s.type)).toEqual(['context_fetch', 'dispatch']);
  });
});

describe('ReasoningTracer.pushExternal', () => {
  it('emits the step + accumulates', () => {
    const { emitter, events } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    tracer.pushExternal({
      type: 'thinking',
      title: 'Thoughts',
      content: 'pondering',
      durationMs: 100,
    });
    expect(events).toHaveLength(1);
    const step = events[0].data as { type: string; content: string };
    expect(step.type).toBe('thinking');
    expect(step.content).toBe('pondering');
    expect(tracer.finalSteps()).toHaveLength(1);
  });

  it('assigns id and timestamp', () => {
    const { emitter } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    tracer.pushExternal({ type: 'logic', title: 't', content: 'c' });
    const step = tracer.finalSteps()[0];
    expect(step.id).toBeTruthy();
    expect(typeof step.timestamp).toBe('number');
  });
});

describe('ReasoningTracer.emitEphemeral', () => {
  it('emitEphemeral emits an SSE reasoning_step but does not persist it', () => {
    const events: Array<{ name: string; data: unknown }> = [];
    const sse = { event: (name: string, data: unknown) => events.push({ name, data }) } as never;
    const tracer = new ReasoningTracer(sse);

    tracer.emitEphemeral({
      type: 'assembled_prompt',
      title: 'Prompt sent to model',
      content: 'SYSTEM…',
    });

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('reasoning_step');
    expect((events[0].data as { type: string }).type).toBe('assembled_prompt');
    expect(tracer.finalSteps()).toHaveLength(0);
  });
});

describe('ReasoningTracer.finalSteps', () => {
  it('returns a shallow copy (mutation does not affect tracer state)', async () => {
    const { emitter } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    await tracer.step({ type: 'context_fetch', title: 'a', run: async () => ({ content: 'a', result: null }) });
    const a = tracer.finalSteps();
    a.push({} as never);
    expect(tracer.finalSteps()).toHaveLength(1);
  });

  it('is idempotent (multiple calls return same content)', async () => {
    const { emitter } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    await tracer.step({ type: 'context_fetch', title: 'a', run: async () => ({ content: 'a', result: null }) });
    expect(tracer.finalSteps()).toEqual(tracer.finalSteps());
  });
});
