import { describe, it, expect, vi } from 'vitest';
import type { SseEmitter } from '@/server/lib/sse';
import { runTddLoop } from './tdd.runner';
import type { TddRunnerDeps, CommandResult } from './tdd.types';

function recordingSse() {
  const events: { name: string; data: any }[] = [];
  const sse: SseEmitter = {
    event: (name, data) => events.push({ name, data: data as any }),
    error: (message) => events.push({ name: 'error', data: { message } }),
    end: () => {},
  };
  return { sse, events };
}

function okDispatcher(spy?: (msg: string) => void) {
  return {
    handle: async (body: { sessionId: string; message: string }, sse: SseEmitter) => {
      spy?.(body.message);
      sse.event('text', { chunk: 'edited a file' });
      sse.event('done', {});
    },
  };
}

function deps(over: Partial<TddRunnerDeps>): TddRunnerDeps {
  const base = okDispatcher();
  return {
    runCommand: vi.fn(async (): Promise<CommandResult> => ({ exitCode: 1, output: 'FAIL' })),
    subAgentsStore: { list: vi.fn(async () => [{ name: 'coder' }]) },
    dispatcher: { handle: vi.fn(base.handle.bind(base)) },
    createSession: vi.fn(async () => 'sess-1'),
    ...over,
  };
}

describe('runTddLoop', () => {
  it('reports already_green when the command passes first', async () => {
    const d = deps({ runCommand: vi.fn(async () => ({ exitCode: 0, output: 'ok' })) });
    const { sse, events } = recordingSse();
    await runTddLoop(d, { command: 'cmd', subAgentName: 'coder' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'tdd_done')?.data.status).toBe('already_green');
    expect(d.createSession).not.toHaveBeenCalled(); // no fixer turn ran
  });

  it('runs a fixer turn then succeeds (red → green)', async () => {
    const results = [{ exitCode: 1, output: 'FAIL: expected 1' }, { exitCode: 0, output: 'pass' }];
    const seen: string[] = [];
    const d = deps({
      runCommand: vi.fn(async () => results.shift()!),
      dispatcher: okDispatcher((m) => seen.push(m)),
    });
    const { sse, events } = recordingSse();
    await runTddLoop(d, { command: 'npx vitest run', subAgentName: 'coder' }, sse, new AbortController().signal);
    expect(seen[0]).toContain('@coder');
    expect(seen[0]).toContain('FAIL: expected 1');
    const done = events.find((e) => e.name === 'tdd_done');
    expect(done?.data.status).toBe('success');
    expect(done?.data.iterations).toBe(1);
  });

  it('stops at max_retries_exceeded after exactly maxRetries fixer turns', async () => {
    const d = deps({ runCommand: vi.fn(async () => ({ exitCode: 1, output: 'still failing' })) });
    const { sse, events } = recordingSse();
    await runTddLoop(d, { command: 'cmd', subAgentName: 'coder', maxRetries: 3 }, sse, new AbortController().signal);
    expect((d.dispatcher.handle as any).mock.calls.length).toBe(3);
    expect(events.find((e) => e.name === 'tdd_done')?.data.status).toBe('max_retries_exceeded');
  });

  it('fails fast on unknown sub-agent', async () => {
    const d = deps({ subAgentsStore: { list: vi.fn(async () => [{ name: 'other' }]) } });
    const { sse, events } = recordingSse();
    await runTddLoop(d, { command: 'cmd', subAgentName: 'ghost' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'tdd_error')?.data.message).toMatch(/ghost/);
    expect(events.find((e) => e.name === 'tdd_done')?.data.status).toBe('error');
    expect(d.runCommand).not.toHaveBeenCalled();
  });

  it('reports error when a fixer turn emits an error event', async () => {
    const d = deps({
      dispatcher: {
        handle: async (_b: any, sse: SseEmitter) => {
          sse.event('error', { message: 'provider down', retryable: false });
        },
      },
    });
    const { sse, events } = recordingSse();
    await runTddLoop(d, { command: 'cmd', subAgentName: 'coder' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'tdd_error')?.data.message).toMatch(/provider down/);
    expect(events.find((e) => e.name === 'tdd_done')?.data.status).toBe('error');
  });

  it('stops with interrupted when the signal is already aborted', async () => {
    const d = deps({});
    const { sse, events } = recordingSse();
    const controller = new AbortController();
    controller.abort();
    await runTddLoop(d, { command: 'cmd', subAgentName: 'coder' }, sse, controller.signal);
    expect(events.find((e) => e.name === 'tdd_done')?.data.status).toBe('interrupted');
  });
});
