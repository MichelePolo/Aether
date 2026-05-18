import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DispatchService } from './dispatch.service';
import { FakeProvider } from './providers/fake.provider';
import { HistoryStore } from '@/server/domain/history/history.store';
import { ContextStore } from '@/server/domain/context/context.store';
import { createCollectorEmitter } from '@/server/test/sse-collector';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-dispatch-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('DispatchService', () => {
  function makeService(opts: { chunks: string[]; chunkDelayMs?: number }) {
    const provider = new FakeProvider({ chunks: opts.chunks, chunkDelayMs: opts.chunkDelayMs, model: 'fake-1' });
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    const service = new DispatchService({ provider, historyStore, contextStore });
    return { service, historyStore, contextStore };
  }

  it('emits text events then done', async () => {
    const { service } = makeService({ chunks: ['Hello', ' world'] });
    const { emitter, events } = createCollectorEmitter();
    const ctrl = new AbortController();
    await service.handle({ message: 'hi' }, emitter, ctrl.signal);
    expect(events.map((e) => e.event)).toEqual(['text', 'text', 'done']);
    expect(events[0].data).toEqual({ chunk: 'Hello' });
    expect(events[1].data).toEqual({ chunk: ' world' });
    expect(events[2].data).toMatchObject({ model: 'fake-1', interrupted: false });
  });

  it('persists user + model messages to history', async () => {
    const { service, historyStore } = makeService({ chunks: ['pong'] });
    const { emitter } = createCollectorEmitter();
    const ctrl = new AbortController();
    await service.handle({ message: 'ping' }, emitter, ctrl.signal);
    const msgs = await historyStore.read();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', text: 'ping' });
    expect(msgs[1]).toMatchObject({ role: 'model', text: 'pong', model: 'fake-1', interrupted: false });
  });

  it('saves partial text + interrupted=true when aborted', async () => {
    const { service, historyStore } = makeService({ chunks: ['a', 'b', 'c'], chunkDelayMs: 20 });
    const { emitter, events } = createCollectorEmitter();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await service.handle({ message: 'ping' }, emitter, ctrl.signal);
    const last = events.at(-1);
    expect(last?.event).toBe('done');
    expect((last?.data as { interrupted: boolean }).interrupted).toBe(true);
    const msgs = await historyStore.read();
    const model = msgs.find((m) => m.role === 'model')!;
    expect(model.interrupted).toBe(true);
    expect(model.text.length).toBeLessThan(3);
  });

  it('passes history + systemInstruction to provider', async () => {
    const { historyStore, contextStore } = makeService({ chunks: ['x'] });
    await contextStore.patch({ systemInstruction: 'YOU_ARE_AETHER' });
    await historyStore.append({ id: 'p1', role: 'user', text: 'first', timestamp: 1 });
    await historyStore.append({ id: 'p2', role: 'model', text: 'reply', timestamp: 2 });

    let captured: unknown;
    class CapturingProvider {
      readonly model = 'cap';
      async *stream(req: unknown) {
        captured = req;
        yield { type: 'text' as const, text: 'x' };
        yield { type: 'done' as const };
      }
    }
    const svc = new (await import('./dispatch.service')).DispatchService({
      // duck-typed test provider
      provider: new CapturingProvider(),
      historyStore,
      contextStore,
    });
    const { emitter } = createCollectorEmitter();
    await svc.handle({ message: 'second' }, emitter, new AbortController().signal);
    expect(captured).toMatchObject({
      systemInstruction: 'YOU_ARE_AETHER',
      history: [
        { role: 'user', text: 'first' },
        { role: 'model', text: 'reply' },
      ],
      userMessage: 'second',
    });
  });

  it('emits error event and ends when provider throws', async () => {
    class FailingProvider {
      readonly model = 'broken';
      async *stream(): AsyncGenerator<never> {
        throw new Error('Authentication failed');
      }
    }
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    const service = new DispatchService({
      // duck-typed test provider
      provider: new FailingProvider(),
      historyStore,
      contextStore,
    });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ message: 'hi' }, emitter, new AbortController().signal);
    const errEvt = events.find((e) => e.event === 'error');
    expect(errEvt).toBeDefined();
    expect((errEvt!.data as { message: string }).message).toMatch(/Authentication/);
    expect((errEvt!.data as { retryable: boolean }).retryable).toBe(false);
  });

  it('emits Context load failed when contextStore throws', async () => {
    const provider = new FakeProvider({ chunks: ['x'] });
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const failingContextStore = {
      read: async () => {
        throw new Error('disk');
      },
    } as unknown as ContextStore;
    const svc = new DispatchService({ provider, historyStore, contextStore: failingContextStore });
    const { emitter, events } = createCollectorEmitter();
    await svc.handle({ message: 'hi' }, emitter, new AbortController().signal);
    const err = events.find((e) => e.event === 'error');
    expect(err).toBeDefined();
    expect((err!.data as { message: string }).message).toBe('Context load failed');
  });

  it('marks transient errors retryable=true', async () => {
    class TransientProvider {
      readonly model = 'rl';
      async *stream(): AsyncGenerator<never> {
        const err = new Error('Network error') as Error & { code?: string };
        err.code = 'ECONNRESET';
        throw err;
      }
    }
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    const service = new DispatchService({
      // duck-typed test provider
      provider: new TransientProvider(),
      historyStore,
      contextStore,
    });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ message: 'hi' }, emitter, new AbortController().signal);
    const errEvt = events.find((e) => e.event === 'error')!;
    expect((errEvt.data as { retryable: boolean }).retryable).toBe(true);
  });
});
