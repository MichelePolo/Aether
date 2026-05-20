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
