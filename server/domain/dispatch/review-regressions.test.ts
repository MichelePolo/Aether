import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import { buildSingleProviderRegistry } from '@/server/test/registry.test-helper';
import { createCollectorEmitter } from '@/server/test/sse-collector';
import { HistoryStore } from '@/server/domain/history/history.store';
import { ContextStore } from '@/server/domain/context/context.store';
import { DispatchService, type DispatchServiceDeps } from './dispatch.service';
import type { AIProvider, ProviderChunk, ProviderRequest } from './providers/provider.types';

const databases: ReturnType<typeof makeTestDb>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
async function harness(stream: AIProvider['stream'], extra: Partial<DispatchServiceDeps> = {}) {
  const db = makeTestDb(); databases.push(db);
  const historyStore = new HistoryStore(db);
  const contextStore = new ContextStore(db);
  const provider: AIProvider = { model: 'review', capabilities: { toolCalling: true, thinking: true, vision: true }, stream };
  const providers = await buildSingleProviderRegistry(provider);
  const session = await historyStore.createEmpty();
  const service = new DispatchService({ historyStore, contextStore, providers, ...extra });
  return { db, service, historyStore, contextStore, sessionId: session.id };
}
const call = (id: string, n: number): ProviderChunk => ({ type: 'function_call', call: { callId: id, qualifiedName: 'mock.echo', args: { n } } });

function tools() {
  const callTool = vi.fn(async (_name: string, args: Record<string, unknown>) => ({ ok: true, output: args }));
  const registry = { policy: () => ({ autoApprove: true }), callTool, listLiveTools: () => [{ qualifiedName: 'mock.echo', tool: { description: '', inputSchema: {} } }] };
  return { callTool, mcpRegistry: registry as unknown as NonNullable<DispatchServiceDeps['mcpRegistry']> };
}

describe('review dispatch regressions', () => {
  it('executes all calls and preserves every round, argument and result in order', async () => {
    const seen: ProviderRequest[] = [];
    const t = tools();
    const h = await harness(async function* (req) {
      seen.push(structuredClone({ ...req, runToolCall: undefined }));
      if (seen.length === 1) { yield { type: 'text', text: 'first' }; yield call('a', 1); yield call('b', 2); }
      else if (seen.length === 2) { yield { type: 'text', text: 'second' }; yield call('c', 3); }
      else yield { type: 'text', text: 'finished' };
      yield { type: 'done', usage: { inputTokens: 2, outputTokens: 1 } };
    }, t);
    const { emitter, events } = createCollectorEmitter();
    await h.service.handle({ sessionId: h.sessionId, message: 'go' }, emitter, new AbortController().signal);
    expect(t.callTool).toHaveBeenCalledTimes(3);
    expect(seen[2].toolRounds?.map(r => ({ text: r.text, args: r.calls.map(c => c.args), ids: r.results.map(r => r.callId) }))).toEqual([
      { text: 'first', args: [{ n: 1 }, { n: 2 }], ids: ['a', 'b'] },
      { text: 'second', args: [{ n: 3 }], ids: ['c'] },
    ]);
    expect(seen[2].toolResults).toHaveLength(3);
    expect(events.find(e => e.event === 'done')?.data).toMatchObject({ tokensIn: 6, tokensOut: 3 });
  });

  it('stops a provider which keeps asking for tools after the cap', async () => {
    const t = tools(); let rounds = 0;
    const h = await harness(async function* (req) {
      rounds++;
      if (rounds === 3) expect(req.mcpTools).toEqual([]);
      yield call(String(rounds), rounds); yield { type: 'done' };
    }, { ...t, maxToolCallsPerDispatch: 2 });
    const { emitter, events } = createCollectorEmitter();
    await h.service.handle({ sessionId: h.sessionId, message: 'go' }, emitter, new AbortController().signal);
    expect(rounds).toBe(3); expect(t.callTool).toHaveBeenCalledTimes(2);
    expect(events.find(e => e.event === 'error')?.data).toMatchObject({ message: expect.stringContaining('Max tool calls') });
  });

  it('uses persisted message IDs in SSE and supplies stored text and image attachments on the next turn', async () => {
    const seen: ProviderRequest[] = [];
    const h = await harness(async function* (req) { seen.push(req); yield { type: 'text', text: 'answer' }; yield { type: 'done' }; });
    const { emitter, events } = createCollectorEmitter();
    await h.service.handle({ sessionId: h.sessionId, message: 'go', attachments: [
      { name: 'code.ts', mime: '', size: 6, contentBase64: Buffer.from('SOURCE').toString('base64') },
      { name: 'picture.png', mime: 'image/png', size: 3, contentBase64: Buffer.from('img').toString('base64') },
    ] }, emitter, new AbortController().signal);
    const ids = events.find(e => e.event === 'message_ids')!.data as { userMessageId: string; modelMessageId: string };
    expect((await h.historyStore.read(h.sessionId))?.map(m => m.id)).toEqual([ids.userMessageId, ids.modelMessageId]);
    await h.service.handle({ sessionId: h.sessionId, message: 'again' }, createCollectorEmitter().emitter, new AbortController().signal);
    expect(seen[1].history[0].text).toContain('SOURCE');
    expect(seen[1].history[0].attachments?.[0].bytes.toString()).toBe('img');
  });

  it('serializes a session and releases its lock after aborting a pending gate', async () => {
    const { McpRegistry } = await import('@/server/domain/mcp/registry');
    const t = tools();
    const h = await harness(async function* () { yield call('a', 1); yield { type: 'done' }; });
    const registry = new McpRegistry(h.contextStore);
    const gate = vi.spyOn(registry, 'awaitDecision');
    const callTool = vi.spyOn(registry, 'callTool');
    const service = new DispatchService({ historyStore: h.historyStore, contextStore: h.contextStore,
      providers: await buildSingleProviderRegistry({ model: 'review', capabilities: { toolCalling: true, vision: false, thinking: false }, stream: async function* () { yield call('a', 1); yield { type: 'done' }; } }),
      mcpRegistry: registry, breakpointService: { resolveDecision: async () => 'gate' } as never });
    const ctrl = new AbortController(); const first = createCollectorEmitter();
    const pending = service.handle({ sessionId: h.sessionId, message: 'first' }, first.emitter, ctrl.signal);
    await vi.waitFor(() => expect(gate).toHaveBeenCalledTimes(1));
    const second = createCollectorEmitter();
    await service.handle({ sessionId: h.sessionId, message: 'duplicate' }, second.emitter, new AbortController().signal);
    expect(second.events.find(e => e.event === 'error')?.data).toMatchObject({ message: expect.stringContaining('already running') });
    ctrl.abort(); await pending;
    expect(callTool).not.toHaveBeenCalled();
    expect((await h.historyStore.read(h.sessionId))?.filter(m => m.role === 'user')).toHaveLength(1);
    expect(first.events.find(e => e.event === 'done')?.data).toMatchObject({ interrupted: true });
    await service.close(); await registry.close();
    expect(t.callTool).not.toHaveBeenCalled();
  });

  it('resumes with the original system instruction despite context changes', async () => {
    const requests: ProviderRequest[] = []; const ctrl = new AbortController();
    const h = await harness(async function* (req) {
      requests.push(req); yield { type: 'text', text: 'partial' };
      if (requests.length === 1) ctrl.abort();
      yield { type: 'done' };
    });
    await h.contextStore.patch({ systemInstruction: 'ORIGINAL' });
    await h.service.handle({ sessionId: h.sessionId, message: 'go', thinking: true }, createCollectorEmitter().emitter, ctrl.signal);
    await h.contextStore.patch({ systemInstruction: 'CHANGED' });
    const messages = await h.historyStore.read(h.sessionId);
    await h.service.resume({ sessionId: h.sessionId, messageId: messages!.at(-1)!.id }, createCollectorEmitter().emitter, new AbortController().signal);
    expect(requests[1].systemInstruction).toBe(requests[0].systemInstruction);
    expect(requests[1].thinking).toBe(true);
  });
});

it('retries a persisted provider error without duplicating the user message', async () => {
  let attempts = 0;
  const h = await harness(async function* () {
    if (++attempts === 1) throw new Error('temporary network error');
    yield { type: 'text', text: 'recovered' }; yield { type: 'done' };
  });
  await h.service.handle({ sessionId: h.sessionId, message: 'once' }, createCollectorEmitter().emitter, new AbortController().signal);
  const failed = (await h.historyStore.read(h.sessionId))!.at(-1)!;
  expect(failed.retryable).toBe(true);
  await h.service.resume({ sessionId: h.sessionId, messageId: failed.id }, createCollectorEmitter().emitter, new AbortController().signal);
  const messages = (await h.historyStore.read(h.sessionId))!;
  expect(messages.filter(m => m.role === 'user')).toHaveLength(1);
  expect(messages.at(-1)?.text).toBe('recovered');
});

it('aborts an SDK-owned provider loop when the tool budget is exhausted', async () => {
  const t = tools(); let providerAborted = false;
  const h = await harness(async function* (req, signal) {
    await req.runToolCall!({ qualifiedName: 'mock.echo', args: {} });
    await req.runToolCall!({ qualifiedName: 'mock.echo', args: {} });
    providerAborted = signal.aborted;
    yield { type: 'done' };
  }, { ...t, maxToolCallsPerDispatch: 1 });
  const rec = createCollectorEmitter();
  await h.service.handle({ sessionId: h.sessionId, message: 'go' }, rec.emitter, new AbortController().signal);
  expect(providerAborted).toBe(true); expect(t.callTool).toHaveBeenCalledOnce();
  expect(rec.events.find(e => e.event === 'error')?.data).toMatchObject({ message: expect.stringContaining('Max tool calls') });
});
