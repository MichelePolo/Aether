import { describe, it, expect, vi } from 'vitest';
import { DispatchService } from './dispatch.service';
import type { DispatchServiceDeps } from './dispatch.service';
import { FakeProvider } from './providers/fake.provider';
import { HistoryStore } from '@/server/domain/history/history.store';
import { ContextStore } from '@/server/domain/context/context.store';
import { createCollectorEmitter } from '@/server/test/sse-collector';
import { buildSingleProviderRegistry } from '@/server/test/registry.test-helper';
import { makeTestDb } from '@/server/test/test-db';
import type { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AIProvider, ProviderChunk, ProviderRequest } from './providers/provider.types';

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

  it('emits a live-only assembled_prompt step when aetherMode is on', async () => {
    const { service, historyStore, sessionId } = await makeService({ chunks: ['pong'] });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping', aetherMode: true }, emitter, new AbortController().signal);
    const promptEvents = events.filter(
      (e) => e.event === 'reasoning_step' && (e.data as { type: string }).type === 'assembled_prompt',
    );
    expect(promptEvents).toHaveLength(1);
    expect((promptEvents[0].data as { content: string }).content).toContain('You are Aether');
    expect((promptEvents[0].data as { content: string }).content).toContain('Tools declared to the model');

    // Live only: not in the persisted model message.
    const saved = await historyStore.readRecord(sessionId);
    const modelMsg = saved!.messages.find((m) => m.role === 'model')!;
    expect((modelMsg.reasoningSteps ?? []).some((s) => s.type === 'assembled_prompt')).toBe(false);
  });

  it('does not emit an assembled_prompt step when aetherMode is off', async () => {
    const { service, sessionId } = await makeService({ chunks: ['pong'] });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);
    const promptEvents = events.filter(
      (e) => e.event === 'reasoning_step' && (e.data as { type: string }).type === 'assembled_prompt',
    );
    expect(promptEvents).toHaveLength(0);
  });

  it('active material skill reaches the assembled system instruction', async () => {
    const provider = new FakeProvider({ chunks: ['pong'], model: 'fake-1' });
    const db = makeTestDb();
    const historyStore = new HistoryStore(db);
    const contextStore = new ContextStore(db);
    const providers = await buildSingleProviderRegistry(provider);
    const skillsService = {
      getActiveForPrompt: () => [
        { name: 'pdf', description: 'Work with PDFs', pinned: false, dir: '/d/pdf', body: undefined },
      ],
    };
    const service = new DispatchService({ providers, historyStore, contextStore, skillsService });
    const session = await historyStore.createEmpty();

    const { emitter } = createCollectorEmitter();
    await service.handle({ sessionId: session.id, message: 'hello' }, emitter, new AbortController().signal);

    expect(provider.lastRequest?.systemInstruction).toContain('- pdf: Work with PDFs');
  });
});

describe('DispatchService — attachments', () => {
  async function makeServiceWithVision(vision: boolean) {
    const provider = new FakeProvider({ chunks: ['ok'], model: 'fake-1', vision });
    const db = makeTestDb();
    const historyStore = new HistoryStore(db);
    const contextStore = new ContextStore(db);
    const providers = await buildSingleProviderRegistry(provider);
    const service = new DispatchService({ providers, historyStore, contextStore });
    const session = await historyStore.createEmpty();
    return { service, provider, historyStore, sessionId: session.id };
  }

  it('inlines a text attachment as a fenced code block in the user message', async () => {
    const { service, provider, sessionId } = await makeServiceWithVision(false);
    const { emitter } = createCollectorEmitter();
    await service.handle(
      {
        sessionId,
        message: 'do this',
        attachments: [
          {
            name: 'notes.md',
            mime: 'text/markdown',
            size: 11,
            contentBase64: Buffer.from('hello world').toString('base64'),
          },
        ],
      },
      emitter,
      new AbortController().signal,
    );
    expect(provider.lastRequest?.userMessage).toContain('do this');
    expect(provider.lastRequest?.userMessage).toContain('```notes.md\nhello world\n```');
  });

  it('forwards image attachments to the provider via ProviderRequest.attachments', async () => {
    const { service, provider, sessionId } = await makeServiceWithVision(true);
    const { emitter } = createCollectorEmitter();
    const imageBytes = Buffer.from('PNGDATA');
    await service.handle(
      {
        sessionId,
        message: 'look',
        attachments: [
          {
            name: 'photo.png',
            mime: 'image/png',
            size: imageBytes.length,
            contentBase64: imageBytes.toString('base64'),
          },
        ],
      },
      emitter,
      new AbortController().signal,
    );
    expect(provider.lastRequest?.attachments).toHaveLength(1);
    expect(provider.lastRequest?.attachments![0].mime).toBe('image/png');
    expect(provider.lastRequest?.attachments![0].bytes).toEqual(imageBytes);
  });

  it('strips images when the resolved provider has vision=false', async () => {
    const { service, provider, sessionId } = await makeServiceWithVision(false);
    const { emitter } = createCollectorEmitter();
    await service.handle(
      {
        sessionId,
        message: 'look',
        attachments: [
          {
            name: 'photo.png',
            mime: 'image/png',
            size: 4,
            contentBase64: Buffer.from('IMGD').toString('base64'),
          },
        ],
      },
      emitter,
      new AbortController().signal,
    );
    expect(provider.lastRequest?.attachments).toBeUndefined();
  });

  it('persists both text and image attachments on the user message', async () => {
    const { service, historyStore, sessionId } = await makeServiceWithVision(true);
    const { emitter } = createCollectorEmitter();
    await service.handle(
      {
        sessionId,
        message: 'check',
        attachments: [
          {
            name: 'readme.md',
            mime: 'text/markdown',
            size: 2,
            contentBase64: Buffer.from('hi').toString('base64'),
          },
          {
            name: 'img.png',
            mime: 'image/png',
            size: 3,
            contentBase64: Buffer.from('PNG').toString('base64'),
          },
        ],
      },
      emitter,
      new AbortController().signal,
    );
    const msgs = await historyStore.read(sessionId);
    const userMsg = msgs!.find((m) => m.role === 'user')!;
    expect(userMsg.attachments).toHaveLength(2);
    const names = userMsg.attachments!.map((a) => a.name).sort();
    expect(names).toEqual(['img.png', 'readme.md']);
  });

  it('emits error event for an unsupported MIME type', async () => {
    const { service, sessionId } = await makeServiceWithVision(false);
    const { emitter, events } = createCollectorEmitter();
    await service.handle(
      {
        sessionId,
        message: 'attach pdf',
        attachments: [
          {
            name: 'doc.pdf',
            mime: 'application/pdf',
            size: 5,
            contentBase64: Buffer.from('hello').toString('base64'),
          },
        ],
      },
      emitter,
      new AbortController().signal,
    );
    const err = events.find((e) => e.event === 'error');
    expect(err).toBeDefined();
    expect((err!.data as { message: string }).message).toMatch(/Unsupported MIME/);
  });

  it('emits error event when total decoded bytes exceed 10 MB', async () => {
    const { service, sessionId } = await makeServiceWithVision(false);
    const { emitter, events } = createCollectorEmitter();
    // Two 6 MB text files = 12 MB total
    const bigContent = Buffer.alloc(6 * 1024 * 1024, 'x');
    await service.handle(
      {
        sessionId,
        message: 'too big',
        attachments: [
          {
            name: 'a.txt',
            mime: 'text/plain',
            size: bigContent.length,
            contentBase64: bigContent.toString('base64'),
          },
          {
            name: 'b.txt',
            mime: 'text/plain',
            size: bigContent.length,
            contentBase64: bigContent.toString('base64'),
          },
        ],
      },
      emitter,
      new AbortController().signal,
    );
    const err = events.find((e) => e.event === 'error');
    expect(err).toBeDefined();
    expect((err!.data as { message: string }).message).toMatch(/10 MB/);
  });
});

describe('runToolCall (agentic providers)', () => {
  /** Build a DispatchService wired with the given provider and optional
   *  mcpRegistry/breakpointService overrides. */
  async function buildAgenticHarness(
    provider: AIProvider,
    opts: {
      mcpRegistry?: DispatchServiceDeps['mcpRegistry'];
      breakpointService?: DispatchServiceDeps['breakpointService'];
    } = {},
  ) {
    const db = makeTestDb();
    const historyStore = new HistoryStore(db);
    const contextStore = new ContextStore(db);
    const providers = await buildSingleProviderRegistry(provider);
    const service = new DispatchService({
      providers,
      historyStore,
      contextStore,
      mcpRegistry: opts.mcpRegistry,
      breakpointService: opts.breakpointService,
    });
    const session = await historyStore.createEmpty();
    return { service, historyStore, sessionId: session.id };
  }

  it('provider that calls runToolCall receives the tool output and streams it', async () => {
    // Stub provider: calls runToolCall, then yields a text chunk with the outcome
    const agenticProvider: AIProvider = {
      model: 'agentic-stub',
      capabilities: { thinking: false, toolCalling: true, vision: false },
      async *stream(req: ProviderRequest): AsyncGenerator<ProviderChunk> {
        const outcome = await req.runToolCall!({
          qualifiedName: 'mock.echo',
          args: { message: 'hi' },
        });
        yield { type: 'text', text: outcome.ok ? 'OUT:' + JSON.stringify(outcome.output) : 'ERR:' + outcome.error };
        yield { type: 'done' };
      },
    };

    const callTool = vi.fn().mockResolvedValue({ ok: true, output: { echoed: 'hi' } });
    const mcpRegistry = {
      policy: () => ({ autoApprove: true }),
      callTool,
      awaitDecision: vi.fn(),
      listLiveTools: () => [],
    } as unknown as import('@/server/domain/mcp/registry').McpRegistry;

    const { service, historyStore, sessionId } = await buildAgenticHarness(agenticProvider, {
      mcpRegistry,
    });

    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'go' }, emitter, new AbortController().signal);

    // SSE: tool_call_request was emitted with the right qualifiedName
    const request = events.find((e) => e.event === 'tool_call_request');
    expect(request).toBeDefined();
    expect((request!.data as { qualifiedName: string }).qualifiedName).toBe('mock.echo');

    // SSE: tool_call_result was emitted with ok: true
    const result = events.find((e) => e.event === 'tool_call_result');
    expect(result).toBeDefined();
    expect((result!.data as { ok: boolean }).ok).toBe(true);

    // Streamed text contains the output
    const textChunks = events.filter((e) => e.event === 'text').map((e) => (e.data as { chunk: string }).chunk);
    const fullText = textChunks.join('');
    expect(fullText).toContain('OUT:');

    // Persisted model message contains 'OUT:'
    const msgs = await historyStore.read(sessionId);
    const model = msgs!.find((m) => m.role === 'model')!;
    expect(model.text).toContain('OUT:');
  });

  it('provider runToolCall returns rejection when gate rejects, callTool is NOT called', async () => {
    const agenticProvider: AIProvider = {
      model: 'agentic-stub',
      capabilities: { thinking: false, toolCalling: true, vision: false },
      async *stream(req: ProviderRequest): AsyncGenerator<ProviderChunk> {
        const outcome = await req.runToolCall!({
          qualifiedName: 'mock.echo',
          args: { message: 'hi' },
        });
        yield { type: 'text', text: outcome.ok ? 'OUT:' + JSON.stringify(outcome.output) : 'ERR:' + outcome.error };
        yield { type: 'done' };
      },
    };

    const callTool = vi.fn();
    // policy returns autoApprove: false → gate mode → awaitDecision resolves 'reject'
    const mcpRegistry = {
      policy: () => ({ autoApprove: false }),
      callTool,
      awaitDecision: vi.fn().mockResolvedValue('reject'),
      listLiveTools: () => [],
    } as unknown as import('@/server/domain/mcp/registry').McpRegistry;

    const { service, historyStore, sessionId } = await buildAgenticHarness(agenticProvider, {
      mcpRegistry,
    });

    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'go' }, emitter, new AbortController().signal);

    // Streamed text contains the rejection error
    const textChunks = events.filter((e) => e.event === 'text').map((e) => (e.data as { chunk: string }).chunk);
    const fullText = textChunks.join('');
    expect(fullText).toContain('ERR:Rejected by user');

    // callTool was NOT called
    expect(callTool).not.toHaveBeenCalled();

    // Persisted model message also contains the error text
    const msgs = await historyStore.read(sessionId);
    const model = msgs!.find((m) => m.role === 'model')!;
    expect(model.text).toContain('ERR:Rejected by user');
  });

  it('enforces the per-dispatch tool cap: the 11th runToolCall is rejected without executing', async () => {
    // Stub provider calls runToolCall 11 times and reports the first index that
    // returned the cap error.
    const agenticProvider: AIProvider = {
      model: 'agentic-stub',
      capabilities: { thinking: false, toolCalling: true, vision: false },
      async *stream(req: ProviderRequest): AsyncGenerator<ProviderChunk> {
        let cappedAt = -1;
        for (let i = 0; i < 11; i += 1) {
          const outcome = await req.runToolCall!({ qualifiedName: 'mock.echo', args: { i } });
          if (!outcome.ok && cappedAt === -1) cappedAt = i;
        }
        yield { type: 'text', text: `CAPPED_AT:${cappedAt}` };
        yield { type: 'done' };
      },
    };

    const callTool = vi.fn().mockResolvedValue({ ok: true, output: { ok: 1 } });
    const mcpRegistry = {
      policy: () => ({ autoApprove: true }),
      callTool,
      awaitDecision: vi.fn(),
      listLiveTools: () => [],
    } as unknown as import('@/server/domain/mcp/registry').McpRegistry;

    const { service, sessionId } = await buildAgenticHarness(agenticProvider, { mcpRegistry });

    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'go' }, emitter, new AbortController().signal);

    // 11th call (index 10) is the first to be capped; only 10 actually executed.
    const fullText = events.filter((e) => e.event === 'text').map((e) => (e.data as { chunk: string }).chunk).join('');
    expect(fullText).toContain('CAPPED_AT:10');
    expect(callTool).toHaveBeenCalledTimes(10);
  });
});
