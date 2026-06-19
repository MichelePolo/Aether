import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SseEmitter } from '@/server/lib/sse';
import { runSwarm, type SwarmOrchestratorDeps } from './swarm.orchestrator';
import { SwarmApprovalRegistry } from './swarm.approval';

function recordingSse() {
  const events: { name: string; data: any }[] = [];
  const sse: SseEmitter = {
    event: (name, data) => events.push({ name, data: data as any }),
    error: (message) => events.push({ name: 'error', data: { message } }),
    end: () => {},
  };
  return { sse, events };
}

function fakeDispatcher(spy?: (msg: string) => void) {
  return {
    handle: async (body: { sessionId: string; message: string }, sse: SseEmitter) => {
      spy?.(body.message);
      sse.event('text', { chunk: `out:${body.message}` });
      sse.event('done', {});
    },
  };
}

function deps(over: Partial<SwarmOrchestratorDeps>): SwarmOrchestratorDeps {
  return {
    store: { read: vi.fn() } as any,
    subAgentsStore: { list: vi.fn(async () => [{ name: 'architect' }, { name: 'coder' }]) } as any,
    dispatcher: fakeDispatcher(),
    createSession: vi.fn(async () => 'sess-1'),
    approvals: new SwarmApprovalRegistry(),
    approvalTimeoutMs: 1000,
    providers: { isAvailable: () => true, defaultName: () => null },
    ...over,
  };
}

// --- helpers for per-step provider tests ---

type MakeDepsOpts = {
  steps: Array<{ subAgentName: string; promptTemplate: string; pauseAfter: boolean; providerName?: string }>;
  subAgents: Array<{ name: string; model?: string }>;
  providers: { isAvailable(name: string): boolean; defaultName(): string | null };
  onHandle?: (body: { sessionId: string; message: string; providerName?: string }) => void;
};

function makeDeps(opts: MakeDepsOpts): SwarmOrchestratorDeps {
  return {
    store: {
      read: vi.fn(async () => ({
        id: 'sw',
        name: 'test-swarm',
        steps: opts.steps,
        createdAt: 0,
        updatedAt: 0,
      })),
    } as any,
    subAgentsStore: {
      list: vi.fn(async () => opts.subAgents),
    } as any,
    dispatcher: {
      handle: async (body: { sessionId: string; message: string; providerName?: string }, sse: SseEmitter) => {
        opts.onHandle?.(body);
        sse.event('text', { chunk: `out:${body.message}` });
        sse.event('done', {});
      },
    },
    createSession: vi.fn(async () => 'sess-test'),
    approvals: new SwarmApprovalRegistry(),
    approvalTimeoutMs: 1000,
    providers: opts.providers,
  };
}

function recordEvents(sse: SseEmitter): Array<{ name: string; data: any }> {
  // sse already records into an array via recordingSse(); we need to intercept events
  // The tests pass `sse` (the SseEmitter) and expect this to return the same events array.
  // We handle this by attaching a shared events array to the sse object.
  return (sse as any).__events as Array<{ name: string; data: any }>;
}

let sse: SseEmitter;
let signal: AbortSignal;
let _sseEvents: Array<{ name: string; data: any }>;

beforeEach(() => {
  _sseEvents = [];
  sse = {
    event: (name, data) => _sseEvents.push({ name, data: data as any }),
    error: (message) => _sseEvents.push({ name: 'error', data: { message } }),
    end: () => {},
  };
  (sse as any).__events = _sseEvents;
  signal = new AbortController().signal;
});

const swarm = {
  id: 's1',
  name: 'build',
  steps: [
    { subAgentName: 'architect', promptTemplate: 'Design:', pauseAfter: false },
    { subAgentName: 'coder', promptTemplate: '', pauseAfter: false },
  ],
  createdAt: 0,
  updatedAt: 0,
};

describe('runSwarm', () => {
  it('runs steps in order, feeding output→input with template prefix', async () => {
    const seen: string[] = [];
    const d = deps({
      store: { read: vi.fn(async () => swarm) } as any,
      dispatcher: fakeDispatcher((m) => seen.push(m)),
    });
    const { sse, events } = recordingSse();
    await runSwarm(d, { swarmId: 's1', input: 'make a todo app' }, sse, new AbortController().signal);

    expect(seen[0]).toBe('@architect Design:\n\nmake a todo app');
    expect(seen[1]).toBe('@coder out:@architect Design:\n\nmake a todo app');
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('done');
  });

  it('fails fast on unknown sub-agent', async () => {
    const bad = { ...swarm, steps: [{ subAgentName: 'ghost', promptTemplate: '', pauseAfter: false }] };
    const d = deps({ store: { read: vi.fn(async () => bad) } as any });
    const { sse, events } = recordingSse();
    await runSwarm(d, { swarmId: 's1', input: 'x' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'swarm_error')?.data.message).toMatch(/ghost/);
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('error');
  });

  it('pauses for approval and stops on reject', async () => {
    const paused = { ...swarm, steps: [{ subAgentName: 'architect', promptTemplate: '', pauseAfter: true }, ...swarm.steps.slice(1)] };
    const approvals = new SwarmApprovalRegistry();
    const d = deps({ store: { read: vi.fn(async () => paused) } as any, approvals });
    const { sse, events } = recordingSse();
    const run = runSwarm(d, { swarmId: 's1', input: 'x' }, sse, new AbortController().signal);
    await new Promise((r) => setTimeout(r, 0));
    const req = events.find((e) => e.name === 'swarm_approval_request');
    expect(req).toBeTruthy();
    approvals.resolveDecision(req!.data.approvalId, 'reject');
    await run;
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('rejected');
  });

  it('errors when the swarm has no steps', async () => {
    const d = deps({ store: { read: vi.fn(async () => ({ ...swarm, steps: [] })) } as any });
    const { sse, events } = recordingSse();
    await runSwarm(d, { swarmId: 's1', input: 'x' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('error');
  });

  it('reports error when a step dispatch emits an error event', async () => {
    const d = deps({
      store: { read: vi.fn(async () => swarm) } as any,
      dispatcher: {
        handle: async (_b: any, sse: SseEmitter) => {
          sse.event('error', { message: 'provider down', retryable: false });
        },
      },
    });
    const { sse, events } = recordingSse();
    await runSwarm(d, { swarmId: 's1', input: 'x' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'swarm_error')?.data.message).toMatch(/provider down/);
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('error');
  });

  it('errors when the swarm is not found', async () => {
    const d = deps({ store: { read: vi.fn(async () => null) } as any });
    const { sse, events } = recordingSse();
    await runSwarm(d, { swarmId: 'missing', input: 'x' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'swarm_error')?.data.message).toMatch(/not found/);
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('error');
  });

  it('stops with interrupted status when the signal is already aborted', async () => {
    const d = deps({ store: { read: vi.fn(async () => swarm) } as any });
    const { sse, events } = recordingSse();
    const controller = new AbortController();
    controller.abort();
    await runSwarm(d, { swarmId: 's1', input: 'x' }, sse, controller.signal);
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('interrupted');
  });

  it('continues to the next step when approval is granted', async () => {
    const paused = { ...swarm, steps: [{ subAgentName: 'architect', promptTemplate: '', pauseAfter: true }, ...swarm.steps.slice(1)] };
    const approvals = new SwarmApprovalRegistry();
    const d = deps({ store: { read: vi.fn(async () => paused) } as any, approvals });
    const { sse: localSse, events } = recordingSse();
    const run = runSwarm(d, { swarmId: 's1', input: 'x' }, localSse, new AbortController().signal);
    await new Promise((r) => setTimeout(r, 0));
    const req = events.find((e) => e.name === 'swarm_approval_request');
    approvals.resolveDecision(req!.data.approvalId, 'approve');
    await run;
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('done');
    expect(events.filter((e) => e.name === 'swarm_step_completed')).toHaveLength(2);
  });

  it('passes the step providerName when available', async () => {
    const seen: Array<string | undefined> = [];
    const d = makeDeps({
      steps: [{ subAgentName: 'a', promptTemplate: '', pauseAfter: false, providerName: 'anthropic:claude-opus-4-7' }],
      subAgents: [{ name: 'a' }],
      providers: { isAvailable: (n) => n === 'anthropic:claude-opus-4-7', defaultName: () => 'fake:default' },
      onHandle: (body) => seen.push(body.providerName),
    });
    await runSwarm(d, { swarmId: 'sw', input: 'go' }, sse, signal);
    expect(seen).toEqual(['anthropic:claude-opus-4-7']);
  });

  it('falls back to default and warns when the requested model is unavailable', async () => {
    const events = recordEvents(sse);
    const seen: Array<string | undefined> = [];
    const d = makeDeps({
      steps: [{ subAgentName: 'a', promptTemplate: '', pauseAfter: false, providerName: 'openai:gpt-4o' }],
      subAgents: [{ name: 'a' }],
      providers: { isAvailable: () => false, defaultName: () => 'fake:default' },
      onHandle: (body) => seen.push(body.providerName),
    });
    await runSwarm(d, { swarmId: 'sw', input: 'go' }, sse, signal);
    expect(seen).toEqual(['fake:default']);
    const warn = events.find((e) => e.name === 'swarm_step_warning');
    expect(warn?.data).toMatchObject({ position: 0, requested: 'openai:gpt-4o', used: 'fake:default' });
  });

  it('uses the sub-agent default model when the step has no override', async () => {
    const seen: Array<string | undefined> = [];
    const d = makeDeps({
      steps: [{ subAgentName: 'a', promptTemplate: '', pauseAfter: false }],
      subAgents: [{ name: 'a', model: 'gemini:gemini-1.5-pro' }],
      providers: { isAvailable: (n) => n === 'gemini:gemini-1.5-pro', defaultName: () => 'fake:default' },
      onHandle: (body) => seen.push(body.providerName),
    });
    await runSwarm(d, { swarmId: 'sw', input: 'go' }, sse, signal);
    expect(seen).toEqual(['gemini:gemini-1.5-pro']);
  });

  it('passes undefined and does not warn when nothing is requested', async () => {
    const events = recordEvents(sse);
    const seen: Array<string | undefined> = [];
    const d = makeDeps({
      steps: [{ subAgentName: 'a', promptTemplate: '', pauseAfter: false }],
      subAgents: [{ name: 'a' }],
      providers: { isAvailable: () => false, defaultName: () => 'fake:default' },
      onHandle: (body) => seen.push(body.providerName),
    });
    await runSwarm(d, { swarmId: 'sw', input: 'go' }, sse, signal);
    expect(seen).toEqual([undefined]);
    expect(events.find((e) => e.name === 'swarm_step_warning')).toBeUndefined();
  });
});
