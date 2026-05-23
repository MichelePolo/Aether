import { describe, it, expect, vi, beforeEach } from 'vitest';

const querySpy = vi.fn();
const createSdkMcpServerSpy = vi.fn((opts: unknown) => ({ type: 'sdk', name: 'aether', instance: { __opts: opts } }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => querySpy(...args),
  createSdkMcpServer: (...args: unknown[]) => createSdkMcpServerSpy(...(args as [unknown])),
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
  createSdkMcpServerSpy.mockClear();
});

describe('AnthropicProvider', () => {
  it('reports declared capabilities and model', () => {
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-6' });
    expect(p.model).toBe('claude-sonnet-4-6');
    expect(p.capabilities).toEqual({ thinking: true, toolCalling: true, vision: true });
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
      { type: 'done', usage: { totalTokens: 8, inputTokens: 3, outputTokens: 5 } },
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

  it('maps tool_use to function_call and terminates the stream (strips mcp__aether__ prefix)', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'I will use a tool' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'TC1', name: 'mcp__aether__mock.echo', input: { message: 'hi' } }] } },
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

  it('forwards tool_use names unchanged when prefix is missing (defensive)', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'TC1', name: 'mock.echo', input: {} }] } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks[0]).toEqual({
      type: 'function_call',
      call: { callId: 'TC1', qualifiedName: 'mock.echo', args: {} },
    });
  });

  it('forwards systemPrompt, history, userMessage to the SDK as an AsyncIterable<SDKUserMessage>', async () => {
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
    }), new AbortController().signal));

    expect(querySpy).toHaveBeenCalledTimes(1);
    const arg = querySpy.mock.calls[0][0] as {
      prompt: AsyncIterable<unknown>;
      options: { systemPrompt: string; model: string; maxTurns: number; tools?: unknown };
    };
    expect(arg.options.systemPrompt).toBe('sys');
    expect(arg.options.model).toBe('claude-sonnet-4-6');
    expect(arg.options.maxTurns).toBe(1);
    // No custom tool declarations in options (SDK only accepts string[] or preset; we'll
    // expose Aether's tools via an in-process MCP server in a follow-up task).
    expect(arg.options.tools).toBeUndefined();

    // Consume the prompt iterable and inspect the messages.
    const messages: unknown[] = [];
    for await (const m of arg.prompt) messages.push(m);
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain('"role":"user"');
    expect(serialized).toContain('"role":"assistant"');
    expect(serialized).toContain('q1');
    expect(serialized).toContain('a1');
    expect(serialized).toContain('q2');
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

    const arg = querySpy.mock.calls[0][0] as { prompt: AsyncIterable<unknown> };
    const messages: unknown[] = [];
    for await (const m of arg.prompt) messages.push(m);
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain('TC1');
    expect(serialized).toContain('thinking out loud');
    expect(serialized).toContain('"type":"tool_result"');
  });

  it('uses budgetTokens (camelCase) when thinking is enabled', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq({ thinking: true }), new AbortController().signal));
    const arg = querySpy.mock.calls[0][0] as { options: { thinking?: Record<string, unknown> } };
    expect(arg.options.thinking).toEqual({ type: 'enabled', budgetTokens: 8000 });
  });

  it('omits the thinking option entirely when req.thinking is falsy', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq(), new AbortController().signal));
    const arg = querySpy.mock.calls[0][0] as { options: { thinking?: unknown } };
    expect(arg.options.thinking).toBeUndefined();
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

  it('builds an in-process MCP server with one tool per req.mcpTools entry', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq({
      mcpTools: [
        { qualifiedName: 'mock.echo', description: 'Echoes', schema: { type: 'object', properties: { message: {} } } },
        { qualifiedName: 'mock.current_time', description: 'Now', schema: { type: 'object', properties: {} } },
      ],
    }), new AbortController().signal));

    expect(createSdkMcpServerSpy).toHaveBeenCalledTimes(1);
    const serverOpts = createSdkMcpServerSpy.mock.calls[0][0] as {
      name: string;
      tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    };
    expect(serverOpts.name).toBe('aether');
    expect(serverOpts.tools).toHaveLength(2);
    expect(serverOpts.tools[0].name).toBe('mock.echo');
    expect(serverOpts.tools[0].description).toBe('Echoes');
    expect(Object.keys(serverOpts.tools[0].inputSchema)).toEqual(['message']);
    expect(serverOpts.tools[1].name).toBe('mock.current_time');

    const arg = querySpy.mock.calls[0][0] as {
      options: { mcpServers: Record<string, unknown>; allowedTools: string[] };
    };
    expect(arg.options.mcpServers).toHaveProperty('aether');
    expect(arg.options.allowedTools).toEqual([
      'mcp__aether__mock.echo',
      'mcp__aether__mock.current_time',
    ]);
  });

  it('does not build an MCP server when req.mcpTools is empty or absent', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq(), new AbortController().signal));
    expect(createSdkMcpServerSpy).not.toHaveBeenCalled();
    const arg = querySpy.mock.calls[0][0] as {
      options: { mcpServers: Record<string, unknown>; allowedTools: string[] };
    };
    expect(arg.options.mcpServers).toEqual({});
    expect(arg.options.allowedTools).toEqual([]);
  });

  it('has vision: true in capabilities', () => {
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-6' });
    expect(p.capabilities.vision).toBe(true);
  });

  it('prepends image blocks to the final user message content when attachments are present', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const pngBytes = Buffer.from('fake-png-bytes');
    await collect(p.stream(baseReq({
      userMessage: 'describe this image',
      attachments: [
        { name: 'test.png', mime: 'image/png', bytes: pngBytes },
      ],
    }), new AbortController().signal));

    const arg = querySpy.mock.calls[0][0] as { prompt: AsyncIterable<unknown> };
    const messages: unknown[] = [];
    for await (const m of arg.prompt) messages.push(m);

    // The last message in the prompt is the user message with image block
    const lastMsg = messages.at(-1) as {
      message: {
        role: string;
        content: Array<{ type: string; source?: { type: string; media_type: string; data: string }; text?: string }>;
      };
    };
    expect(lastMsg.message.role).toBe('user');
    expect(lastMsg.message.content).toHaveLength(2);
    expect(lastMsg.message.content[0]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: pngBytes.toString('base64'),
      },
    });
    expect(lastMsg.message.content[1]).toEqual({ type: 'text', text: 'describe this image' });
  });

  it('sends only a text block when there are no attachments', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq({ userMessage: 'plain text' }), new AbortController().signal));

    const arg = querySpy.mock.calls[0][0] as { prompt: AsyncIterable<unknown> };
    const messages: unknown[] = [];
    for await (const m of arg.prompt) messages.push(m);

    const lastMsg = messages.at(-1) as {
      message: { role: string; content: Array<{ type: string; text?: string }> };
    };
    expect(lastMsg.message.content).toHaveLength(1);
    expect(lastMsg.message.content[0]).toEqual({ type: 'text', text: 'plain text' });
  });
});
