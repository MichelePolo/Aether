import { z } from 'zod';

const TagsResponse = z.object({
  models: z.array(z.object({ name: z.string() })),
});

export const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
export const ANTHROPIC_VERSION = '2023-06-01';

const AnthropicModelsResponse = z.object({
  data: z.array(z.object({ id: z.string(), created_at: z.string() })),
});

export interface AnthropicDiscovery {
  models: string[];
  error: string | null;
}

export async function discoverOllama(host: string, token?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    const parsed = TagsResponse.safeParse(body);
    if (!parsed.success) return [];
    return parsed.data.models.map((m) => m.name);
  } catch {
    return [];
  }
}

export async function discoverAnthropic(apiKey: string): Promise<AnthropicDiscovery> {
  try {
    const res = await fetch(`${ANTHROPIC_MODELS_URL}?limit=1000`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { models: [], error: String(res.status) };
    const body = await res.json();
    const parsed = AnthropicModelsResponse.safeParse(body);
    if (!parsed.success) return { models: [], error: 'parse' };
    const models = [...parsed.data.data]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((m) => m.id);
    return { models, error: null };
  } catch (err) {
    return { models: [], error: anthropicErrorReason(err) };
  }
}

function anthropicErrorReason(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)/);
  return m?.[1] ?? 'error';
}

export function geminiHardcodedModels(): string[] {
  return [
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ];
}

export function anthropicHardcodedModels(): string[] {
  return ['claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
}

export function openAIHardcodedModels(): string[] {
  return ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'o3'];
}
