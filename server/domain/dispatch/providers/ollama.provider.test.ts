import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaProvider } from './ollama.provider';
import type { ProviderChunk } from './provider.types';

function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
}

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('capabilities = { thinking: false, toolCalling: true, vision: false }', () => {
    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    expect(p.capabilities).toEqual({ thinking: false, toolCalling: true, vision: false });
  });

  it('streams text chunks from NDJSON message.content', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: ndjsonStream([
        JSON.stringify({ message: { role: 'assistant', content: 'hello ' } }),
        JSON.stringify({ message: { role: 'assistant', content: 'world' } }),
        JSON.stringify({ done: true, eval_count: 5, prompt_eval_count: 3 }),
      ]),
    } as Response);

    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    const chunks: ProviderChunk[] = [];
    for await (const c of p.stream(
      { systemInstruction: '', history: [], userMessage: 'hi' },
      new AbortController().signal,
    )) {
      chunks.push(c);
    }
    const text = chunks.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('');
    expect(text).toBe('hello world');
    const done = chunks.find((c) => c.type === 'done');
    expect(done).toEqual({ type: 'done', usage: { totalTokens: 8 } });
  });

  it('emits function_call chunks for tool_calls in the response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: ndjsonStream([
        JSON.stringify({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'mock.echo', arguments: { message: 'hi' } } }],
          },
        }),
        JSON.stringify({ done: true }),
      ]),
    } as Response);

    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    const chunks: ProviderChunk[] = [];
    for await (const c of p.stream(
      { systemInstruction: '', history: [], userMessage: 'go' },
      new AbortController().signal,
    )) {
      chunks.push(c);
    }
    const fc = chunks.find((c) => c.type === 'function_call');
    expect(fc).toBeTruthy();
    if (fc && fc.type === 'function_call') {
      expect(fc.call.qualifiedName).toBe('mock.echo');
      expect(fc.call.args).toEqual({ message: 'hi' });
      expect(typeof fc.call.callId).toBe('string');
    }
  });

  it('forwards mcpTools as tools array', async () => {
    let captured: unknown = null;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(init?.body as string);
      return {
        ok: true,
        body: ndjsonStream([JSON.stringify({ done: true })]),
      } as Response;
    });

    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    for await (const _ of p.stream(
      {
        systemInstruction: '',
        history: [],
        userMessage: 'go',
        mcpTools: [{ qualifiedName: 'mock.echo', description: 'echo', schema: { type: 'object' } }],
      },
      new AbortController().signal,
    )) { /* drain */ }
    const body = captured as { tools: Array<{ type: string; function: { name: string } }> };
    expect(body.tools[0].function.name).toBe('mock.echo');
  });

  it('on continuation (toolResults present), prepends a tool message', async () => {
    let captured: unknown = null;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(init?.body as string);
      return {
        ok: true,
        body: ndjsonStream([JSON.stringify({ done: true })]),
      } as Response;
    });

    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    for await (const _ of p.stream(
      {
        systemInstruction: '',
        history: [],
        userMessage: 'go',
        toolResults: [{
          callId: 'C1',
          qualifiedName: 'mock.echo',
          ok: true,
          output: { message: 'hi' },
        }],
      },
      new AbortController().signal,
    )) { /* drain */ }
    const body = captured as { messages: Array<{ role: string; content?: string }> };
    const toolMsg = body.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeTruthy();
    expect(toolMsg?.content).toContain('hi');
  });

  it('rejects with parsed error message on non-OK response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'model not found' }),
    } as Response);

    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    const drain = async () => {
      for await (const _ of p.stream(
        { systemInstruction: '', history: [], userMessage: 'go' },
        new AbortController().signal,
      )) { /* drain */ }
    };
    await expect(drain()).rejects.toThrow(/model not found/);
  });

  it('adds Authorization: Bearer header to /api/chat when token is set', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
    } as unknown as Response);

    const p = new OllamaProvider({ host: 'http://gpu.lan:11434', model: 'llama3', token: 'tok-123' });
    for await (const _ of p.stream(
      { systemInstruction: '', history: [], userMessage: 'hi' },
      new AbortController().signal,
    )) { /* drain */ }

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-123' });
  });

  it('NRT: con solo token invia Authorization: Bearer e nessun header extra', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        body: ndjsonStream(['{"done":true}']),
      } as Response;
    });

    const p = new OllamaProvider({ host: 'http://h:11434', model: 'm', token: 't' });
    for await (const _ of p.stream(
      { systemInstruction: '', history: [], userMessage: 'hi' },
      new AbortController().signal,
    )) { /* drain */ }

    expect(calls[0].url).toBe('http://h:11434/api/chat');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer t');
  });

  it('fonde headers custom sopra il Bearer token', async () => {
    const calls: { init: RequestInit }[] = [];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init: RequestInit) => {
      calls.push({ init });
      return {
        ok: true,
        body: ndjsonStream(['{"done":true}']),
      } as Response;
    });

    const p = new OllamaProvider({ host: 'http://h:11434', model: 'm', token: 't', headers: { 'X-Tenant': 'acme' } });
    for await (const _ of p.stream(
      { systemInstruction: '', history: [], userMessage: 'hi' },
      new AbortController().signal,
    )) { /* drain */ }

    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer t');
    expect(h['X-Tenant']).toBe('acme');
  });
});
