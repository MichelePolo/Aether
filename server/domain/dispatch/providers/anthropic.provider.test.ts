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

  it('sends history flattened into a SINGLE user-role message (never role:assistant)', async () => {
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

    const arg = querySpy.mock.calls[0][0] as {
      prompt: AsyncIterable<{ message: { role: string; content: Array<{ type: string; text?: string }> } }>;
      options: { systemPrompt: string; model: string; maxTurns: number };
    };
    expect(arg.options.systemPrompt).toBe('sys');
    expect(arg.options.model).toBe('claude-sonnet-4-6');
    expect(arg.options.maxTurns).toBeGreaterThan(1);

    const messages: Array<{ message: { role: string; content: Array<{ type: string; text?: string }> } }> = [];
    for await (const m of arg.prompt) messages.push(m);
    expect(messages).toHaveLength(1);
    expect(messages.every((m) => m.message.role === 'user')).toBe(true);
    const text = messages[0].message.content.find((c) => c.type === 'text')!.text!;
    expect(text).toContain('q1');
    expect(text).toContain('a1');
    expect(text).toContain('q2');
  });

  it('registers tool handlers that delegate execution to req.runToolCall', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const runToolCall = vi.fn(async () => ({ ok: true, output: { echoed: 'hi' } }));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq({
      mcpTools: [{ qualifiedName: 'mock.echo', description: 'Echoes', schema: { type: 'object', properties: { message: {} } } }],
      runToolCall,
    }), new AbortController().signal));

    const serverOpts = createSdkMcpServerSpy.mock.calls[0][0] as {
      tools: Array<{ name: string; handler: (a: unknown, e: unknown) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }>;
    };
    const handler = serverOpts.tools[0].handler;
    const result = await handler({ message: 'hi' }, {});
    expect(runToolCall).toHaveBeenCalledWith({ qualifiedName: 'mock.echo', args: { message: 'hi' } });
    expect(result.content[0].text).toContain('echoed');
    expect(result.isError).toBeUndefined();

    // Allow-listed at SERVER scope (not per-tool): the SDK normalizes tool names,
    // so a per-tool dotted allowlist would not match and the call would be denied.
    const arg = querySpy.mock.calls[0][0] as { options: { allowedTools: string[] } };
    expect(arg.options.allowedTools).toEqual(['mcp__aether']);
  });

  it('handler maps a failed runToolCall outcome to an isError CallToolResult', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([{ type: 'result', usage: { input_tokens: 0, output_tokens: 0 } }]));
    const runToolCall = vi.fn(async () => ({ ok: false, error: 'Rejected by user' }));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq({
      mcpTools: [{ qualifiedName: 'mock.echo', description: '', schema: { type: 'object', properties: {} } }],
      runToolCall,
    }), new AbortController().signal));
    const serverOpts = createSdkMcpServerSpy.mock.calls[0][0] as { tools: Array<{ handler: (a: unknown, e: unknown) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }> };
    const result = await serverOpts.tools[0].handler({}, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Rejected by user');
  });

  it('does NOT yield a function_call chunk when the SDK reports a tool_use (SDK owns execution)', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'TC1', name: 'mcp__aether__mock.echo', input: {} }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
      { type: 'result', usage: { input_tokens: 1, output_tokens: 1 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks.find((c) => c.type === 'function_call')).toBeUndefined();
    expect(chunks).toContainEqual({ type: 'text', text: 'done' });
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

  it('isolates the spawned agent: disables built-in tools and external settings', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq(), new AbortController().signal));
    const arg = querySpy.mock.calls[0][0] as { options: { tools?: unknown; settingSources?: unknown } };
    // tools:[] => no built-in Bash/Write/Task; only Aether MCP tools are available.
    expect(arg.options.tools).toEqual([]);
    // settingSources:[] => no external skills/settings/CLAUDE.md leak in.
    expect(arg.options.settingSources).toEqual([]);
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
    // Server-level allow regardless of how many tools the server exposes.
    expect(arg.options.allowedTools).toEqual(['mcp__aether']);
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

    // There is exactly ONE message in the prompt (history flattened into user message)
    const lastMsg = messages[0] as {
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
    expect(lastMsg.message.content[1].text).toContain('describe this image');
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

    const lastMsg = messages[0] as {
      message: { role: string; content: Array<{ type: string; text?: string }> };
    };
    expect(lastMsg.message.content).toHaveLength(1);
    expect(lastMsg.message.content[0].text).toContain('plain text');
  });
});
