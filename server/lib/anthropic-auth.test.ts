import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const spawnSpy = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...args),
}));

const querySpy = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => querySpy(...args),
}));

import { detectAnthropicAuth } from './anthropic-auth';

function fakeChild(opts: { exitCode?: number; emitError?: NodeJS.ErrnoException; delayMs?: number }) {
  const listeners: Record<string, ((arg?: unknown) => void)[]> = { exit: [], error: [] };
  const child = {
    on(event: string, cb: (arg?: unknown) => void) {
      (listeners[event] ??= []).push(cb);
      return child;
    },
    kill() {
      // no-op in tests
    },
  };
  setTimeout(() => {
    if (opts.emitError) listeners.error.forEach((cb) => cb(opts.emitError));
    else listeners.exit.forEach((cb) => cb(opts.exitCode ?? 0));
  }, opts.delayMs ?? 0);
  return child;
}

beforeEach(() => {
  spawnSpy.mockReset();
  querySpy.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('detectAnthropicAuth', () => {
  it("returns 'none' when claude CLI is missing", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ emitError: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }));
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  });

  it("returns 'apikey' when CLI present and ANTHROPIC_API_KEY is set", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ exitCode: 0 }));
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const result = await detectAnthropicAuth();
    expect(result).toBe('apikey');
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("returns 'oauth' when CLI present, no env key, SDK probe succeeds", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ exitCode: 0 }));
    querySpy.mockImplementation(() => (async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'pong' }] } };
    })());
    const result = await detectAnthropicAuth();
    expect(result).toBe('oauth');
  });

  it("returns 'none' when CLI present, no env key, SDK probe throws", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ exitCode: 0 }));
    querySpy.mockImplementation(() => (async function* () {
      throw new Error('AuthenticationError');
    })());
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  });

  it("returns 'none' when claude --version hangs past 2s timeout", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ exitCode: 0, delayMs: 3000 }));
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  }, 7_000);

  it("returns 'none' when SDK probe hangs past 5s timeout", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ exitCode: 0 }));
    querySpy.mockImplementation(() => (async function* () {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      yield { type: 'assistant', message: { content: [] } };
    })());
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  }, 10_000);
});
