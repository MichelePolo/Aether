import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { discoverOllama, geminiHardcodedModels, discoverAnthropic, ANTHROPIC_MODELS_URL } from './discovery';

describe('discoverOllama', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns model names from /api/tags', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { name: 'llama3:latest' },
          { name: 'mistral:7b' },
        ],
      }),
    } as Response);
    const tags = await discoverOllama('http://localhost:11434');
    expect(tags).toEqual(['llama3:latest', 'mistral:7b']);
  });

  it('returns [] when fetch rejects', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await discoverOllama('http://localhost:11434')).toEqual([]);
  });

  it('returns [] on non-OK response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    expect(await discoverOllama('http://localhost:11434')).toEqual([]);
  });

  it('returns [] when JSON shape is wrong', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ broken: true }),
    } as Response);
    expect(await discoverOllama('http://localhost:11434')).toEqual([]);
  });

  it('sends an Authorization: Bearer header when a token is given', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [{ name: 'llama3:latest' }] }),
    } as Response);
    await discoverOllama('http://gpu.lan:11434', 'tok-123');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://gpu.lan:11434/api/tags',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok-123' } }),
    );
  });

  it('sends no auth header when token is absent', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [] }),
    } as Response);
    await discoverOllama('http://localhost:11434');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.objectContaining({ headers: {} }));
  });
});

describe('geminiHardcodedModels', () => {
  it('returns a non-empty list of known model names', () => {
    const models = geminiHardcodedModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models).toEqual(expect.arrayContaining(['gemini-2.0-flash-exp']));
  });
});

describe('discoverAnthropic', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: typeof fetch): void {
    vi.stubGlobal('fetch', vi.fn(impl) as unknown as typeof fetch);
  }

  it('returns ids sorted newest-first on success', async () => {
    stubFetch(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'claude-old', created_at: '2024-01-01T00:00:00Z' },
            { id: 'claude-new', created_at: '2026-05-01T00:00:00Z' },
            { id: 'claude-mid', created_at: '2025-03-01T00:00:00Z' },
          ],
        }),
        { status: 200 },
      ),
    );
    const out = await discoverAnthropic('sk-ant');
    expect(out).toEqual({ models: ['claude-new', 'claude-mid', 'claude-old'], error: null });
  });

  it('sends auth headers to the models endpoint', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    stubFetch(spy as unknown as typeof fetch);
    await discoverAnthropic('sk-secret');
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain(ANTHROPIC_MODELS_URL);
    expect((init as RequestInit).headers).toMatchObject({
      'x-api-key': 'sk-secret',
      'anthropic-version': '2023-06-01',
    });
  });

  it('returns the status code as error on non-2xx', async () => {
    stubFetch(async () => new Response(null, { status: 401 }));
    expect(await discoverAnthropic('sk-ant')).toEqual({ models: [], error: '401' });
  });

  it('returns a parse error on a malformed body', async () => {
    stubFetch(async () => new Response(JSON.stringify({ nope: true }), { status: 200 }));
    expect(await discoverAnthropic('sk-ant')).toEqual({ models: [], error: 'parse' });
  });

  it('returns an error reason when fetch throws', async () => {
    stubFetch(async () => {
      throw new Error('ENOTFOUND api.anthropic.com');
    });
    expect(await discoverAnthropic('sk-ant')).toEqual({ models: [], error: 'ENOTFOUND' });
  });
});
