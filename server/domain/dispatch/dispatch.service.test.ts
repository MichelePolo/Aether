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
  async function makeService(opts: { chunks: string[]; chunkDelayMs?: number }) {
    const provider = new FakeProvider({ chunks: opts.chunks, chunkDelayMs: opts.chunkDelayMs, model: 'fake-1' });
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    const service = new DispatchService({ provider, historyStore, contextStore });
    const session = await historyStore.createEmpty();
    return { service, historyStore, contextStore, sessionId: session.id };
  }

  it('emits text events then done', async () => {
    const { service, sessionId } = await makeService({ chunks: ['Hello', ' world'] });
    const { emitter, events } = createCollectorEmitter();
    const ctrl = new AbortController();
    await service.handle({ sessionId, message: 'hi' }, emitter, ctrl.signal);
    expect(events.map((e) => e.event)).toEqual(['text', 'text', 'done']);
    expect(events[2].data).toMatchObject({ model: 'fake-1', interrupted: false });
  });

  it('persists user + model messages to the specified session', async () => {
    const { service, historyStore, sessionId } = await makeService({ chunks: ['pong'] });
    const { emitter } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);
    const msgs = await historyStore.read(sessionId);
    expect(msgs!.map((m) => `${m.role}:${m.text}`)).toEqual(['user:ping', 'model:pong']);
  });

  it('does not touch other sessions', async () => {
    const { service, historyStore, sessionId } = await makeService({ chunks: ['pong'] });
    const other = await historyStore.createEmpty();
    const { emitter } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);
    const otherMsgs = await historyStore.read(other.id);
    expect(otherMsgs).toEqual([]);
  });

  it('emits Session not found when sessionId does not exist', async () => {
    const { service } = await makeService({ chunks: ['x'] });
    const { emitter, events } = createCollectorEmitter();
    await service.handle(
      { sessionId: 'no-such-session', message: 'hi' },
      emitter,
      new AbortController().signal,
    );
    const err = events.find((e) => e.event === 'error');
    expect(err).toBeDefined();
    expect((err!.data as { message: string }).message).toBe('Session not found');
    expect((err!.data as { retryable: boolean }).retryable).toBe(false);
  });

  it('emits Invalid request body for missing sessionId', async () => {
    const { service } = await makeService({ chunks: ['x'] });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ message: 'hi' }, emitter, new AbortController().signal);
    expect(events.find((e) => e.event === 'error')).toBeDefined();
  });

  it('passes history + systemInstruction to provider', async () => {
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    await contextStore.patch({ systemInstruction: 'YOU_ARE_AETHER' });
    const session = await historyStore.createEmpty();
    await historyStore.append(session.id, { id: 'p1', role: 'user', text: 'first', timestamp: 1 });
    await historyStore.append(session.id, { id: 'p2', role: 'model', text: 'reply', timestamp: 2 });

    let captured: unknown;
    class CapturingProvider {
      readonly model = 'cap';
      async *stream(req: unknown) {
        captured = req;
        yield { type: 'text' as const, text: 'x' };
        yield { type: 'done' as const };
      }
    }
    const svc = new DispatchService({
      provider: new CapturingProvider(),
      historyStore,
      contextStore,
    });
    const { emitter } = createCollectorEmitter();
    await svc.handle(
      { sessionId: session.id, message: 'second' },
      emitter,
      new AbortController().signal,
    );
    expect(captured).toMatchObject({
      systemInstruction: 'YOU_ARE_AETHER',
      history: [
        { role: 'user', text: 'first' },
        { role: 'model', text: 'reply' },
      ],
      userMessage: 'second',
    });
  });

  it('saves partial + interrupted=true when aborted', async () => {
    const { service, historyStore, sessionId } = await makeService({ chunks: ['a', 'b', 'c'], chunkDelayMs: 20 });
    const { emitter, events } = createCollectorEmitter();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await service.handle({ sessionId, message: 'ping' }, emitter, ctrl.signal);
    const last = events.at(-1);
    expect(last?.event).toBe('done');
    expect((last?.data as { interrupted: boolean }).interrupted).toBe(true);
    const msgs = await historyStore.read(sessionId);
    const model = msgs!.find((m) => m.role === 'model')!;
    expect(model.interrupted).toBe(true);
  });
});
