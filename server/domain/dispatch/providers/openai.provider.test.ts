import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from './openai.provider';
import type { ProviderChunk, ProviderRequest } from './provider.types';

function ssePayload(frames: string[]): string {
  return frames.map((f) => `data: ${f}\n\n`).join('') + 'data: [DONE]\n\n';
}

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(s));
      controller.close();
    },
  });
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
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAIProvider', () => {
  it('reports model and capability per-model (o3 thinks, others do not)', () => {
    expect(new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' }).capabilities).toEqual({
      thinking: false,
      toolCalling: true,
    });
    expect(new OpenAIProvider({ apiKey: 'sk-x', model: 'o3' }).capabilities).toEqual({
      thinking: true,
      toolCalling: true,
    });
    expect(new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' }).model).toBe('gpt-5');
  });

  it('maps multi-chunk delta.content to ordered text chunks + done with totalTokens', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: { content: 'hello ' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } }),
      ])), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));

    expect(chunks).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
      { type: 'done', usage: { totalTokens: 8, inputTokens: 3, outputTokens: 5 } },
    ]);
  });

  it('yields thinking chunks only when req.thinking === true (delta.reasoning)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: { reasoning: 'pondering...' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 1 } }),
      ])), { status: 200 }),
    );

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'o3' });
    const withThinking = await collect(p.stream(baseReq({ thinking: true }), new AbortController().signal));
    expect(withThinking).toContainEqual({ type: 'thinking', text: 'pondering...' });
  });

  it('yields thinking chunks for delta.reasoning_content (alternate field name)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: { reasoning_content: 'alt-naming' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 1 } }),
      ])), { status: 200 }),
    );

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'o3' });
    const chunks = await collect(p.stream(baseReq({ thinking: true }), new AbortController().signal));
    expect(chunks).toContainEqual({ type: 'thinking', text: 'alt-naming' });
  });

  it('drops thinking blocks when req.thinking is falsy', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: { reasoning: 'silent' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 1 } }),
      ])), { status: 200 }),
    );

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'o3' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks.find((c) => c.type === 'thinking')).toBeUndefined();
    expect(chunks).toContainEqual({ type: 'text', text: 'answer' });
  });

  it('accumulates partial tool_call arguments and emits function_call on finish_reason: tool_calls', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'TC1', type: 'function', function: { name: 'mock.echo', arguments: '{"mess' } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'age":"hi"}' } }] } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ])), { status: 200 }),
    );

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks).toEqual([
      { type: 'function_call', call: { callId: 'TC1', qualifiedName: 'mock.echo', args: { message: 'hi' } } },
    ]);
  });

  it('forwards correct body: messages, tools, stream, stream_options.include_usage', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 0 } }),
      ])), { status: 200 });
    });

    const p = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-5' });
    await collect(p.stream(baseReq({
      systemInstruction: 'sys',
      history: [
        { role: 'user', text: 'q1' },
        { role: 'model', text: 'a1' },
      ],
      userMessage: 'q2',
      mcpTools: [{ qualifiedName: 'mock.echo', description: 'd', schema: { type: 'object', properties: { message: { type: 'string' } } } }],
    }), new AbortController().signal));

    expect(captured.url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = new Headers(captured.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-test');
    expect(headers.get('accept')).toBe('text/event-stream');

    const body = JSON.parse(captured.init?.body as string) as {
      model: string;
      stream: boolean;
      stream_options: { include_usage: boolean };
      messages: Array<{ role: string; content?: string }>;
      tools: Array<{ type: string; function: { name: string } }>;
    };
    expect(body.model).toBe('gpt-5');
    expect(body.stream).toBe(true);
    expect(body.stream_options.include_usage).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'q1' });
    expect(body.messages[2]).toEqual({ role: 'assistant', content: 'a1' });
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'q2' });
    expect(body.tools[0].function.name).toBe('mock.echo');
  });

  it('threads toolResults back as the assistant tool_calls + tool result pair', async () => {
    let captured: { init?: RequestInit } = {};
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      captured = { init };
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 0 } }),
      ])), { status: 200 });
    });

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' });
    await collect(p.stream(baseReq({
      toolResults: [
        { callId: 'TC1', qualifiedName: 'mock.echo', ok: true, output: { message: 'hi' } },
      ],
    }), new AbortController().signal));

    const body = JSON.parse(captured.init?.body as string) as {
      messages: Array<Record<string, unknown>>;
    };
    const idxAssistant = body.messages.findIndex((m) => m.role === 'assistant' && Array.isArray(m.tool_calls));
    expect(idxAssistant).toBeGreaterThanOrEqual(0);
    const tcMsg = body.messages[idxAssistant] as { tool_calls: Array<{ id: string; function: { name: string } }> };
    expect(tcMsg.tool_calls[0].id).toBe('TC1');
    expect(tcMsg.tool_calls[0].function.name).toBe('mock.echo');

    const idxToolResult = body.messages.findIndex((m) => m.role === 'tool');
    expect(idxToolResult).toBeGreaterThan(idxAssistant);
    expect(body.messages[idxToolResult]).toMatchObject({
      role: 'tool',
      tool_call_id: 'TC1',
      content: JSON.stringify({ message: 'hi' }),
    });
  });

  it('splices pendingAssistantText as an assistant turn before the new userMessage', async () => {
    let captured: { init?: RequestInit } = {};
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      captured = { init };
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 0 } }),
      ])), { status: 200 });
    });

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' });
    await collect(p.stream(baseReq({ pendingAssistantText: 'partial answer' }), new AbortController().signal));

    const body = JSON.parse(captured.init?.body as string) as {
      messages: Array<{ role: string; content?: string }>;
    };
    const idx = body.messages.findIndex((m) => m.role === 'assistant' && m.content === 'partial answer');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(body.messages[idx + 1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('throws OpenAI auth failed message on HTTP 401', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'invalid_api_key' } }), { status: 401 }),
    );
    const p = new OpenAIProvider({ apiKey: 'sk-bad', model: 'gpt-5' });
    await expect(collect(p.stream(baseReq(), new AbortController().signal))).rejects.toThrow(
      /OpenAI auth failed/,
    );
  });

  it('throws with API error message on HTTP 429', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'rate_limit_exceeded' } }), { status: 429 }),
    );
    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' });
    await expect(collect(p.stream(baseReq(), new AbortController().signal))).rejects.toThrow(
      /rate_limit_exceeded/,
    );
  });

  it('forwards the abort signal to fetch', async () => {
    const aborter = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 0 } }),
      ])), { status: 200 });
    });

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' });
    await collect(p.stream(baseReq(), aborter.signal));
    expect(receivedSignal).toBe(aborter.signal);
  });
});
