import { describe, it, expect } from 'vitest';
import { DispatchService } from './dispatch.service';
import { FakeProvider } from './providers/fake.provider';
import { HistoryStore } from '@/server/domain/history/history.store';
import { ContextStore } from '@/server/domain/context/context.store';
import { createCollectorEmitter } from '@/server/test/sse-collector';
import { buildSingleProviderRegistry } from '@/server/test/registry.test-helper';
import { makeTestDb } from '@/server/test/test-db';

describe('DispatchService', () => {
  async function makeService(opts: {
    chunks: string[];
    thoughtChunks?: string[];
    chunkDelayMs?: number;
    totalTokens?: number;
  }) {
    const provider = new FakeProvider({
      chunks: opts.chunks,
      thoughtChunks: opts.thoughtChunks,
      chunkDelayMs: opts.chunkDelayMs,
      model: 'fake-1',
      totalTokens: opts.totalTokens,
    });
    const db = makeTestDb();
    const historyStore = new HistoryStore(db);
    const contextStore = new ContextStore(db);
    const providers = await buildSingleProviderRegistry(provider);
    const service = new DispatchService({ providers, historyStore, contextStore });
    const session = await historyStore.createEmpty();
    return { service, historyStore, contextStore, sessionId: session.id };
  }

  it('emits context_fetch, dispatch, validation steps (no thinking when thinking=false)', async () => {
    const { service, sessionId } = await makeService({ chunks: ['pong'] });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);
    const steps = events.filter((e) => e.event === 'reasoning_step').map((e) => (e.data as { type: string }).type);
    expect(steps).toEqual(['context_fetch', 'dispatch', 'validation']);
  });

  it('emits context_fetch, dispatch, thinking, validation when thinking=true and thoughts present', async () => {
    const { service, sessionId } = await makeService({
      chunks: ['pong'],
      thoughtChunks: ['ponder'],
    });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping', thinking: true }, emitter, new AbortController().signal);
    const steps = events.filter((e) => e.event === 'reasoning_step').map((e) => (e.data as { type: string }).type);
    expect(steps).toEqual(['context_fetch', 'dispatch', 'thinking', 'validation']);
  });

  it('does NOT emit thinking step when thinking=true but no thoughts produced', async () => {
    const { service, sessionId } = await makeService({ chunks: ['pong'] }); // no thoughtChunks
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping', thinking: true }, emitter, new AbortController().signal);
    const steps = events.filter((e) => e.event === 'reasoning_step').map((e) => (e.data as { type: string }).type);
    expect(steps).toEqual(['context_fetch', 'dispatch', 'validation']);
  });

  it('emits event:thinking chunks during dispatch when thoughts present', async () => {
    const { service, sessionId } = await makeService({
      chunks: ['pong'],
      thoughtChunks: ['ponder', ' more'],
    });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping', thinking: true }, emitter, new AbortController().signal);
    const thinkingChunks = events
      .filter((e) => e.event === 'thinking')
      .map((e) => (e.data as { chunk: string }).chunk);
    expect(thinkingChunks).toEqual(['ponder', ' more']);
  });

  it('done event includes reasoningSteps matching what was persisted', async () => {
    const { service, historyStore, sessionId } = await makeService({ chunks: ['pong'] });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);
    const done = events.find((e) => e.event === 'done')!;
    const reasoningSteps = (done.data as { reasoningSteps: { type: string }[] }).reasoningSteps;
    expect(reasoningSteps.map((s) => s.type)).toEqual(['context_fetch', 'dispatch', 'validation']);
    const msgs = await historyStore.read(sessionId);
    const model = msgs!.find((m) => m.role === 'model')!;
    expect(model.reasoningSteps).toHaveLength(3);
  });

  it('validation step content reports tokens when usage available', async () => {
    const { service, sessionId } = await makeService({ chunks: ['pong'], totalTokens: 42 });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);
    const validation = events
      .filter((e) => e.event === 'reasoning_step')
      .find((e) => (e.data as { type: string }).type === 'validation')!;
    expect((validation.data as { tokens?: number }).tokens).toBe(42);
    expect((validation.data as { content: string }).content).toContain('tokens 42');
  });

  it('persists partial reasoningSteps on provider error', async () => {
    class FailingProvider {
      readonly model = 'broken';
      readonly capabilities = { thinking: true, toolCalling: true };
      async *stream(): AsyncGenerator<never> {
        throw new Error('Auth failed');
      }
    }
    const db = makeTestDb();
    const historyStore = new HistoryStore(db);
    const contextStore = new ContextStore(db);
    const providers = await buildSingleProviderRegistry(new FailingProvider() as unknown as import('./providers/provider.types').AIProvider);
    const service = new DispatchService({
      providers,
      historyStore,
      contextStore,
    });
    const session = await historyStore.createEmpty();
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId: session.id, message: 'hi' }, emitter, new AbortController().signal);
    const err = events.find((e) => e.event === 'error');
    expect(err).toBeDefined();
    const msgs = await historyStore.read(session.id);
    const model = msgs!.find((m) => m.role === 'model')!;
    // context_fetch was emitted before the provider threw → it should be persisted
    expect(model.reasoningSteps?.[0]?.type).toBe('context_fetch');
  });

  it('persists reasoningSteps on aborted stream', async () => {
    const { service, historyStore, sessionId } = await makeService({
      chunks: ['a', 'b', 'c'],
      chunkDelayMs: 20,
    });
    const { emitter, events } = createCollectorEmitter();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await service.handle({ sessionId, message: 'ping' }, emitter, ctrl.signal);
    const done = events.find((e) => e.event === 'done')!;
    expect((done.data as { interrupted: boolean }).interrupted).toBe(true);
    const msgs = await historyStore.read(sessionId);
    const model = msgs!.find((m) => m.role === 'model')!;
    expect(model.reasoningSteps?.length).toBeGreaterThanOrEqual(2); // context_fetch + dispatch
    expect(model.interrupted).toBe(true);
  });

  it('getInFlightController returns undefined for unknown callId', async () => {
    const { service } = await makeService({ chunks: ['pong'] });
    expect(service.getInFlightController('nonexistent')).toBeUndefined();
  });
});
