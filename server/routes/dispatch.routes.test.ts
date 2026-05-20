import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '@/server/app';
import { ContextStore } from '@/server/domain/context/context.store';
import { HistoryStore } from '@/server/domain/history/history.store';
import { DispatchService } from '@/server/domain/dispatch/dispatch.service';
import { FakeProvider } from '@/server/domain/dispatch/providers/fake.provider';
import { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
import { McpRegistry } from '@/server/domain/mcp/registry';
import { collectSseEvents } from '@/server/test/sse-collector';
import { buildSingleProviderRegistry } from '@/server/test/registry.test-helper';

let dir: string;
let contextStore: ContextStore;
let historyStore: HistoryStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-disp-routes-'));
  contextStore = new ContextStore(path.join(dir, 'context.json'));
  historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function appWith(chunks: string[]) {
  const provider = new FakeProvider({ chunks });
  const providers = await buildSingleProviderRegistry(provider);
  const dispatcher = new DispatchService({ providers, historyStore, contextStore });
  const app = createApp({ contextStore, historyStore, dispatcher });
  const session = await historyStore.createEmpty();
  return { app, sessionId: session.id };
}

describe('/api/ai/dispatch', () => {
  it('streams text + done events', async () => {
    const { app, sessionId } = await appWith(['Hello', ' world']);
    const res = await request(app)
      .post('/api/ai/dispatch')
      .set('Accept', 'text/event-stream')
      .send({ sessionId, message: 'hi' });
    expect(res.status).toBe(200);
    const events = await collectSseEvents(res);
    expect(
      events.map((e) => e.event).filter((ev) => ev === 'text' || ev === 'done'),
    ).toEqual(['text', 'text', 'done']);
  });

  it('persists messages to the right session', async () => {
    const { app, sessionId } = await appWith(['pong']);
    await request(app).post('/api/ai/dispatch').send({ sessionId, message: 'ping' });
    const msgs = await historyStore.read(sessionId);
    expect(msgs!.map((m) => `${m.role}:${m.text}`)).toEqual(['user:ping', 'model:pong']);
  });

  it('emits error event for invalid body', async () => {
    const { app } = await appWith(['x']);
    const res = await request(app).post('/api/ai/dispatch').send({});
    const events = await collectSseEvents(res);
    expect(events.find((e) => e.event === 'error')).toBeDefined();
  });

  it('emits Session not found for unknown sessionId', async () => {
    const { app } = await appWith(['x']);
    const res = await request(app)
      .post('/api/ai/dispatch')
      .send({ sessionId: 'nope', message: 'hi' });
    const events = await collectSseEvents(res);
    const err = events.find((e) => e.event === 'error');
    expect(err).toBeDefined();
    expect((err!.data as { message: string }).message).toBe('Session not found');
  });

  it('returns 503 when dispatcher is not configured', async () => {
    const app = createApp({ contextStore, historyStore });
    const res = await request(app).post('/api/ai/dispatch').send({ sessionId: 'x', message: 'x' });
    expect(res.status).toBe(503);
  });

  it('forwards thinking=true through to the service (emits thinking chunks)', async () => {
    const provider = new FakeProvider({ chunks: ['pong'], thoughtChunks: ['ponder'] });
    const providers = await buildSingleProviderRegistry(provider);
    const dispatcher = new DispatchService({ providers, historyStore, contextStore });
    const app = createApp({ contextStore, historyStore, dispatcher });
    const session = await historyStore.createEmpty();

    const res = await request(app)
      .post('/api/ai/dispatch')
      .send({ sessionId: session.id, message: 'ping', thinking: true });
    const events = await collectSseEvents(res);
    const thinkingChunks = events.filter((e) => e.event === 'thinking');
    expect(thinkingChunks.length).toBeGreaterThan(0);
  });

  it('rejects non-boolean thinking', async () => {
    const { app, sessionId } = await appWith(['x']);
    const res = await request(app)
      .post('/api/ai/dispatch')
      .send({ sessionId, message: 'hi', thinking: 'yes' });
    const events = await collectSseEvents(res);
    expect(events.find((e) => e.event === 'error')).toBeDefined();
  });
});

describe('dispatch with @subagent', () => {
  let saDir: string;

  afterEach(async () => {
    if (saDir) await rm(saDir, { recursive: true, force: true });
  });

  it('emits resolve_subagent step and tags dispatch step', async () => {
    saDir = mkdtempSync(path.join(tmpdir(), 'aether-dispatch-sa-'));
    const subAgentsStore = new SubAgentsStore(path.join(saDir, 'subagents.json'));
    await subAgentsStore.create({ name: 'designer', systemInstruction: 'Design.' });

    const provider = new FakeProvider({ chunks: ['ok'] });
    const providers = await buildSingleProviderRegistry(provider);
    const dispatcher = new DispatchService({ providers, historyStore, contextStore, subAgentsStore });
    const app = createApp({ contextStore, historyStore, dispatcher });
    const session = await historyStore.createEmpty();

    const res = await request(app)
      .post('/api/ai/dispatch')
      .set('Accept', 'text/event-stream')
      .send({ sessionId: session.id, message: '@designer ping' });

    expect(res.status).toBe(200);
    const events = await collectSseEvents(res);

    const reasoningSteps = events
      .filter((e) => e.event === 'reasoning_step')
      .map((e) => e.data as { type: string; subAgent?: string });

    const resolveStep = reasoningSteps.find((s) => s.type === 'resolve_subagent');
    expect(resolveStep).toBeDefined();
    expect(resolveStep?.subAgent).toBe('designer');

    const dispatchStep = reasoningSteps.find((s) => s.type === 'dispatch');
    expect(dispatchStep).toBeDefined();
    expect(dispatchStep?.subAgent).toBe('designer');

    expect(provider.lastRequest?.systemInstruction).toContain('# Sub-agent: designer');
    expect(provider.lastRequest?.userMessage).toBe('ping');

    const msgs = await historyStore.read(session.id);
    const userMsg = msgs?.find((m) => m.role === 'user');
    expect(userMsg?.text).toBe('@designer ping');
  });

  it('with unknown @name: no resolve_subagent step; userMessage unstripped', async () => {
    saDir = mkdtempSync(path.join(tmpdir(), 'aether-dispatch-sa-2-'));
    const subAgentsStore = new SubAgentsStore(path.join(saDir, 'subagents.json'));
    // No subagent named 'unknown' is created.

    const provider = new FakeProvider({ chunks: ['ok'] });
    const providers = await buildSingleProviderRegistry(provider);
    const dispatcher = new DispatchService({ providers, historyStore, contextStore, subAgentsStore });
    const app = createApp({ contextStore, historyStore, dispatcher });
    const session = await historyStore.createEmpty();

    const res = await request(app)
      .post('/api/ai/dispatch')
      .set('Accept', 'text/event-stream')
      .send({ sessionId: session.id, message: '@unknown hello' });

    expect(res.status).toBe(200);
    const events = await collectSseEvents(res);

    const reasoningSteps = events
      .filter((e) => e.event === 'reasoning_step')
      .map((e) => e.data as { type: string });

    expect(reasoningSteps.find((s) => s.type === 'resolve_subagent')).toBeUndefined();
    expect(provider.lastRequest?.userMessage).toBe('@unknown hello');
  });
});

describe('dispatch with MCP tool call (slice 7)', () => {
  let mcpDir: string;

  afterEach(async () => {
    if (mcpDir) await rm(mcpDir, { recursive: true, force: true });
  });

  it('emits tool_call_request, tool_call_result, and tracer tool_call step (auto-approve path)', async () => {
    mcpDir = mkdtempSync(path.join(tmpdir(), 'aether-dispatch-mcp-'));
    const mcpContextStore = new ContextStore(path.join(mcpDir, 'context.json'));

    // Add a mock MCP server config to the context store
    const srv = await mcpContextStore.addMcpServer({
      name: 'mock',
      transport: 'mock',
      status: 'offline',
    });

    // Create the registry and connect so listLiveTools() returns tools
    const mcpRegistry = new McpRegistry(mcpContextStore);
    await mcpRegistry.connect(srv.id);

    // FakeProvider emits one function_call then 'final-text' on continuation
    const provider = new FakeProvider({
      chunks: ['final-text'],
      functionCallSequence: [
        { callId: 'call-1', qualifiedName: 'mock.echo', args: { message: 'pong' } },
      ],
    });

    const providers = await buildSingleProviderRegistry(provider);
    const dispatcher = new DispatchService({
      providers,
      historyStore,
      contextStore: mcpContextStore,
      mcpRegistry,
    });
    const app = createApp({ contextStore: mcpContextStore, historyStore, dispatcher });
    const session = await historyStore.createEmpty();

    const res = await request(app)
      .post('/api/ai/dispatch')
      .set('Accept', 'text/event-stream')
      .send({ sessionId: session.id, message: 'test tool call' });

    expect(res.status).toBe(200);
    const events = await collectSseEvents(res);

    // Check for tool_call_request event
    const toolCallRequestEvent = events.find((e) => e.event === 'tool_call_request');
    expect(toolCallRequestEvent).toBeDefined();
    expect((toolCallRequestEvent!.data as { qualifiedName: string }).qualifiedName).toBe('mock.echo');
    const callId = (toolCallRequestEvent!.data as { callId: string }).callId;
    expect(callId).toBe('call-1');

    // Check for tool_call_result event
    const toolCallResultEvent = events.find((e) => e.event === 'tool_call_result');
    expect(toolCallResultEvent).toBeDefined();
    expect((toolCallResultEvent!.data as { ok: boolean }).ok).toBe(true);
    expect((toolCallResultEvent!.data as { id: string }).id).toBe('call-1');

    // Check for reasoning_step of type 'tool_call'
    const reasoningSteps = events
      .filter((e) => e.event === 'reasoning_step')
      .map((e) => e.data as { type: string; toolCall?: { qualifiedName: string } });

    const toolCallStep = reasoningSteps.find((s) => s.type === 'tool_call');
    expect(toolCallStep).toBeDefined();
    expect(toolCallStep?.toolCall?.qualifiedName).toBe('mock.echo');

    // Check final text event contains 'final-text'
    const textEvents = events.filter((e) => e.event === 'text');
    const allText = textEvents.map((e) => (e.data as { chunk: string }).chunk).join('');
    expect(allText).toContain('final-text');

    // Check history: assistant message should have tool_call reasoning step
    const msgs = await historyStore.read(session.id);
    const modelMsg = msgs?.find((m) => m.role === 'model');
    expect(modelMsg).toBeDefined();
    const toolCallInHistory = modelMsg?.reasoningSteps?.find((s) => s.type === 'tool_call');
    expect(toolCallInHistory).toBeDefined();
    expect((toolCallInHistory as { toolCall?: { qualifiedName: string } } | undefined)?.toolCall?.qualifiedName).toBe('mock.echo');
  });
});
