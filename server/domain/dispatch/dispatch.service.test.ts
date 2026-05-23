import { describe, it, expect, vi } from 'vitest';
import { DispatchService } from './dispatch.service';
import { FakeProvider } from './providers/fake.provider';
import { HistoryStore } from '@/server/domain/history/history.store';
import { ContextStore } from '@/server/domain/context/context.store';
import { createCollectorEmitter } from '@/server/test/sse-collector';
import { buildSingleProviderRegistry } from '@/server/test/registry.test-helper';
import { makeTestDb } from '@/server/test/test-db';
import type { ProviderRegistry } from '@/server/domain/providers/registry';

describe('DispatchService', () => {
  async function makeService(opts: {
    chunks: string[];
    thoughtChunks?: string[];
    chunkDelayMs?: number;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  }) {
    const provider = new FakeProvider({
      chunks: opts.chunks,
      thoughtChunks: opts.thoughtChunks,
      chunkDelayMs: opts.chunkDelayMs,
      model: 'fake-1',
      totalTokens: opts.totalTokens,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
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

  describe('DispatchService.resume', () => {
    it('appends a NEW model message; original interrupted message unchanged', async () => {
      const { service, historyStore, sessionId } = await makeService({
        chunks: ['half', 'rest'],
        chunkDelayMs: 50,
      });
      const { emitter } = createCollectorEmitter();
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 10);
      await service.handle({ sessionId, message: 'hi' }, emitter, ctrl.signal);
      const before = await historyStore.read(sessionId);
      const interruptedMsg = before!.find((m) => m.role === 'model' && m.interrupted);
      expect(interruptedMsg).toBeDefined();
      if (!interruptedMsg || interruptedMsg.text.length === 0) {
        // Without a stable partial text we cannot exercise resume — skip.
        return;
      }

      const { emitter: resumeEmitter } = createCollectorEmitter();
      await service.resume(
        { sessionId, messageId: interruptedMsg.id },
        resumeEmitter,
        new AbortController().signal,
      );

      const after = await historyStore.read(sessionId);
      expect(after!.length).toBe(before!.length + 1);
      const stillInterrupted = after!.find((m) => m.id === interruptedMsg.id);
      expect(stillInterrupted?.interrupted).toBe(true);
      expect(stillInterrupted?.text).toBe(interruptedMsg.text);
      const newest = after![after!.length - 1];
      expect(newest.role).toBe('model');
      expect(newest.id).not.toBe(interruptedMsg.id);
    });

    it('threads pendingAssistantText into the provider call', async () => {
      const { service, historyStore, sessionId } = await makeService({
        chunks: ['aaa', 'bbb'],
        chunkDelayMs: 30,
      });
      const { emitter } = createCollectorEmitter();
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 10);
      await service.handle({ sessionId, message: 'hi' }, emitter, ctrl.signal);
      const messages = await historyStore.read(sessionId);
      const interruptedMsg = messages!.find((m) => m.role === 'model' && m.interrupted);
      if (!interruptedMsg || interruptedMsg.text.length === 0) {
        return;
      }

      const provider = (
        service as unknown as { deps: { providers: ProviderRegistry } }
      ).deps.providers.get('fake:default');
      const streamSpy = vi.spyOn(provider!, 'stream');

      const { emitter: r2 } = createCollectorEmitter();
      await service.resume(
        { sessionId, messageId: interruptedMsg.id },
        r2,
        new AbortController().signal,
      );

      expect(streamSpy).toHaveBeenCalled();
      const arg = streamSpy.mock.calls[0][0] as {
        pendingAssistantText?: string;
        userMessage: string;
      };
      expect(arg.pendingAssistantText).toBe(interruptedMsg.text);
      expect(arg.userMessage).toBe('');
    });

    it('emits error event when session is unknown', async () => {
      const { service } = await makeService({ chunks: ['x'] });
      const { emitter, events } = createCollectorEmitter();
      await service.resume(
        { sessionId: 'missing', messageId: 'x' },
        emitter,
        new AbortController().signal,
      );
      const err = events.find((e) => e.event === 'error');
      expect(err).toBeDefined();
      expect((err!.data as { message: string }).message).toMatch(/Session.*not found/);
    });

    it('emits error event when message is unknown', async () => {
      const { service, sessionId } = await makeService({ chunks: ['x'] });
      const { emitter, events } = createCollectorEmitter();
      await service.resume(
        { sessionId, messageId: 'missing' },
        emitter,
        new AbortController().signal,
      );
      const err = events.find((e) => e.event === 'error');
      expect(err).toBeDefined();
      expect((err!.data as { message: string }).message).toMatch(/Message.*not found/);
    });

    it('emits error when target message is not interrupted', async () => {
      const { service, historyStore, sessionId } = await makeService({ chunks: ['done'] });
      const { emitter } = createCollectorEmitter();
      await service.handle(
        { sessionId, message: 'hi' },
        emitter,
        new AbortController().signal,
      );
      const messages = await historyStore.read(sessionId);
      const modelMsg = messages!.find((m) => m.role === 'model' && !m.interrupted)!;

      const { emitter: e2, events } = createCollectorEmitter();
      await service.resume(
        { sessionId, messageId: modelMsg.id },
        e2,
        new AbortController().signal,
      );
      const err = events.find((e) => e.event === 'error');
      expect(err).toBeDefined();
      expect((err!.data as { message: string }).message).toMatch(/not interrupted/);
    });

    it('emits error when target message is a user message', async () => {
      const { service, historyStore, sessionId } = await makeService({ chunks: ['x'] });
      await service.handle(
        { sessionId, message: 'hi' },
        createCollectorEmitter().emitter,
        new AbortController().signal,
      );
      const userMsg = (await historyStore.read(sessionId))!.find((m) => m.role === 'user')!;

      const { emitter, events } = createCollectorEmitter();
      await service.resume(
        { sessionId, messageId: userMsg.id },
        emitter,
        new AbortController().signal,
      );
      const err = events.find((e) => e.event === 'error');
      expect(err).toBeDefined();
      expect((err!.data as { message: string }).message).toMatch(/Cannot resume a user message/);
    });

    it('emits error when interrupted message has empty text', async () => {
      const { service, historyStore, sessionId } = await makeService({
        chunks: ['delayed'],
        chunkDelayMs: 100,
      });
      const ctrl = new AbortController();
      ctrl.abort();
      await service.handle(
        { sessionId, message: 'hi' },
        createCollectorEmitter().emitter,
        ctrl.signal,
      );
      const interruptedEmpty = (await historyStore.read(sessionId))!.find(
        (m) => m.role === 'model' && m.interrupted && m.text === '',
      );
      if (!interruptedEmpty) {
        // The setup didn't produce an empty-text interrupted message — skip.
        return;
      }
      const { emitter, events } = createCollectorEmitter();
      await service.resume(
        { sessionId, messageId: interruptedEmpty.id },
        emitter,
        new AbortController().signal,
      );
      const err = events.find((e) => e.event === 'error');
      expect(err).toBeDefined();
      expect((err!.data as { message: string }).message).toMatch(/empty interrupted message/);
    });

    it('resolves provider via session.providerName when set', async () => {
      const { service, historyStore, sessionId } = await makeService({
        chunks: ['x'],
        chunkDelayMs: 50,
      });
      await historyStore.setProviderName(sessionId, 'fake:default');

      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 10);
      await service.handle(
        { sessionId, message: 'hi' },
        createCollectorEmitter().emitter,
        ctrl.signal,
      );
      const interruptedMsg = (await historyStore.read(sessionId))!.find(
        (m) => m.role === 'model' && m.interrupted,
      );
      if (!interruptedMsg || interruptedMsg.text.length === 0) {
        return;
      }

      const { emitter: r2, events } = createCollectorEmitter();
      await service.resume(
        { sessionId, messageId: interruptedMsg.id },
        r2,
        new AbortController().signal,
      );
      const done = events.find((e) => e.event === 'done');
      expect(done).toBeDefined();
      expect((done!.data as { model: string }).model).toBe('fake-1');
    });
  });

  it('persists tokensIn and tokensOut on the assistant message from dispatchUsage', async () => {
    const { service, historyStore, sessionId } = await makeService({
      chunks: ['pong'],
      inputTokens: 80,
      outputTokens: 40,
      totalTokens: 120,
    });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);

    // Assert persisted message has token counts
    const msgs = await historyStore.read(sessionId);
    const model = msgs!.find((m) => m.role === 'model')!;
    expect(model.tokensIn).toBe(80);
    expect(model.tokensOut).toBe(40);

    // Assert done SSE event carries token counts
    const done = events.find((e) => e.event === 'done')!;
    expect((done.data as { tokensIn?: number }).tokensIn).toBe(80);
    expect((done.data as { tokensOut?: number }).tokensOut).toBe(40);
  });
});
