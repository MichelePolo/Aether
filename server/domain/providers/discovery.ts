import { z } from 'zod';

const TagsResponse = z.object({
  models: z.array(z.object({ name: z.string() })),
});

export async function discoverOllama(host: string): Promise<string[]> {
  try {
    const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`);
    if (!res.ok) return [];
    const body = await res.json();
    const parsed = TagsResponse.safeParse(body);
    if (!parsed.success) return [];
    return parsed.data.models.map((m) => m.name);
  } catch {
    return [];
  }
}

export function geminiHardcodedModels(): string[] {
  return [
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ];
}

export function anthropicHardcodedModels(): string[] {
  return ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
}

export function openAIHardcodedModels(): string[] {
  return ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'o3'];
}
