import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { discoverOllama, geminiHardcodedModels } from './discovery';

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
