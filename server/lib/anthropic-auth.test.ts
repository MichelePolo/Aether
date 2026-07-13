import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const querySpy = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => querySpy(...args),
}));

import { detectAnthropicAuth } from './anthropic-auth';

beforeEach(() => {
  querySpy.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('detectAnthropicAuth', () => {
  it("returns 'none' when the bundled SDK cannot use OAuth", async () => {
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  });

  it("returns 'apikey' when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const result = await detectAnthropicAuth();
    expect(result).toBe('apikey');
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("returns 'oauth' when the bundled SDK probe succeeds", async () => {
    querySpy.mockImplementation(() => (async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'pong' }] } };
    })());
    const result = await detectAnthropicAuth();
    expect(result).toBe('oauth');
  });

  it("returns 'none' when the SDK probe throws", async () => {
    querySpy.mockImplementation(() => (async function* () {
      throw new Error('AuthenticationError');
    })());
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  });

  it("returns 'none' when SDK yields an assistant message with error field", async () => {
    querySpy.mockImplementation(() => (async function* () {
      yield { type: 'assistant', error: 'authentication_failed', message: { content: [] } };
    })());
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  });

  it("passes abortController (not abortSignal) to the SDK so cancellation actually fires", async () => {
    querySpy.mockImplementation(() => (async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'pong' }] } };
    })());
    await detectAnthropicAuth();
    const arg = querySpy.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(arg.options.abortController).toBeInstanceOf(AbortController);
    expect(arg.options.abortSignal).toBeUndefined();
    expect(arg.options.pathToClaudeCodeExecutable).toEqual(expect.any(String));
  });

  it("returns 'none' when SDK probe hangs past 5s timeout", async () => {
    querySpy.mockImplementation(() => (async function* () {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      yield { type: 'assistant', message: { content: [] } };
    })());
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  }, 10_000);
});
