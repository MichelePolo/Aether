import { describe, it, expect, vi } from 'vitest';
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
    ...over,
  };
}

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
});
