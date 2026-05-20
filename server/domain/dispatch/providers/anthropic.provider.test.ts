import { describe, it, expect, vi, beforeEach } from 'vitest';

const querySpy = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => querySpy(...args),
}));

import { AnthropicProvider } from './anthropic.provider';
import type { ProviderChunk, ProviderRequest } from './provider.types';

function asyncIterableFrom<T>(events: T[]): AsyncIterable<T> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

function baseReq(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    systemInstruction: 'You are Aether',
    history: [],
    userMessage: 'hi',
    ...overrides,
  };
}

async function collect(it: AsyncIterable<ProviderChunk>): Promise<ProviderChunk[]> {
  const out: ProviderChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

beforeEach(() => {
  querySpy.mockReset();
});

describe('AnthropicProvider', () => {
  it('reports declared capabilities and model', () => {
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-6' });
    expect(p.model).toBe('claude-sonnet-4-6');
    expect(p.capabilities).toEqual({ thinking: true, toolCalling: true });
  });

  it('maps SDK text content blocks to text chunks', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello ' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'world' }] } },
      { type: 'result', usage: { input_tokens: 3, output_tokens: 5 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
      { type: 'done', usage: { totalTokens: 8 } },
    ]);
  });

  it('maps thinking blocks only when req.thinking === true', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'pondering...' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
      { type: 'result', usage: { input_tokens: 1, output_tokens: 2 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const chunks = await collect(p.stream(baseReq({ thinking: true }), new AbortController().signal));
    expect(chunks).toContainEqual({ type: 'thinking', text: 'pondering...' });
    expect(chunks).toContainEqual({ type: 'text', text: 'answer' });
  });

  it('drops thinking blocks when req.thinking is falsy', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'silent' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks.find((c) => c.type === 'thinking')).toBeUndefined();
    expect(chunks).toContainEqual({ type: 'text', text: 'answer' });
  });

  it('maps tool_use to function_call and terminates the stream', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'I will use a tool' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'TC1', name: 'mock.echo', input: { message: 'hi' } }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'should not appear' }] } },
      { type: 'result', usage: { input_tokens: 5, output_tokens: 5 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks).toEqual([
      { type: 'text', text: 'I will use a tool' },
      { type: 'function_call', call: { callId: 'TC1', qualifiedName: 'mock.echo', args: { message: 'hi' } } },
    ]);
  });

  it('forwards systemPrompt, history, userMessage, and tools to the SDK', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-6' });
    await collect(p.stream(baseReq({
      systemInstruction: 'sys',
      history: [
        { role: 'user', text: 'q1' },
        { role: 'model', text: 'a1' },
      ],
      userMessage: 'q2',
      mcpTools: [{ qualifiedName: 'mock.echo', description: 'd', schema: { type: 'object' } }],
    }), new AbortController().signal));

    expect(querySpy).toHaveBeenCalledTimes(1);
    const arg = querySpy.mock.calls[0][0] as {
      prompt: unknown;
      options: { systemPrompt: string; model: string; maxTurns: number };
    };
    expect(arg.options.systemPrompt).toBe('sys');
    expect(arg.options.model).toBe('claude-sonnet-4-6');
    expect(arg.options.maxTurns).toBe(1);
    const serialized = JSON.stringify(arg);
    expect(serialized).toContain('q1');
    expect(serialized).toContain('a1');
    expect(serialized).toContain('q2');
    expect(serialized).toContain('mock.echo');
  });

  it('threads toolResults back into the SDK prompt on continuation', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq({
      pendingAssistantText: 'thinking out loud',
      toolResults: [
        { callId: 'TC1', qualifiedName: 'mock.echo', ok: true, output: { message: 'hi' } },
      ],
    }), new AbortController().signal));

    const arg = querySpy.mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(arg);
    expect(serialized).toContain('TC1');
    expect(serialized).toContain('thinking out loud');
  });

  it('forwards the abort signal as an AbortController to the SDK', async () => {
    const aborter = new AbortController();
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq(), aborter.signal));
    const arg = querySpy.mock.calls[0][0] as { options: { abortController?: AbortController } };
    expect(arg.options.abortController).toBeInstanceOf(AbortController);
  });

  it('throws when an assistant event carries an error field', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', error: 'authentication_failed', message: { content: [] } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await expect(collect(p.stream(baseReq(), new AbortController().signal))).rejects.toThrow(/authentication_failed/);
  });
});
