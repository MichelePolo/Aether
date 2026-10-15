import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { codexHome } from '@/server/lib/codex-auth';

const TagsResponse = z.object({
  models: z.array(z.object({ name: z.string(), capabilities: z.array(z.string()).optional() })),
});

/**
 * Only chat-capable models can back a provider. Ollama also lists embedding and
 * decision (`/v1/systemone`) models, which fail on `/api/chat`. Servers that don't
 * report capabilities (Ollama before they were added to /api/tags, compatible
 * gateways) keep every model, as before.
 */
export function isOllamaChatModel(capabilities: string[] | undefined): boolean {
  if (!capabilities?.length) return true;
  return capabilities.includes('completion') && !capabilities.includes('decision');
}

export const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
export const ANTHROPIC_VERSION = '2023-06-01';

const AnthropicModelsResponse = z.object({
  data: z.array(z.object({ id: z.string(), created_at: z.string() })),
});

export interface AnthropicDiscovery {
  models: string[];
  error: string | null;
}

export async function discoverOllama(host: string, token?: string, headers?: Record<string, string>): Promise<string[]> {
  try {
    const headersMerged: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    };
    const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`, {
      headers: headersMerged,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    const parsed = TagsResponse.safeParse(body);
    if (!parsed.success) return [];
    return parsed.data.models.filter((m) => isOllamaChatModel(m.capabilities)).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function discoverOpenAICompat(baseUrl: string, headers?: Record<string, string>): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: headers ?? {},
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = await res.json() as { data?: Array<{ id?: string }> };
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
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
  // OAuth fallback catalog, used when live discovery (Agent SDK
  // supportedModels, see anthropic-oauth-models.ts) fails, and appended after
  // the live list so sessions and sub-agents pinned to older IDs keep working.
  // Checked 2026-10-15 against the Agent SDK 0.3.300 model list and
  // https://platform.claude.com/docs/en/models/overview
  // The first entry is the boot default provider (server/index.ts defaultOverride).
  return [
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-fable-5-1',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-fable-5',
    'claude-haiku-4-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-sonnet-4-6',
  ];
}

export function openAIHardcodedModels(): string[] {
  return ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'o3'];
}

/** Fallback when the Codex CLI hasn't written its models cache yet. */
export function codexHardcodedModels(): string[] {
  return ['gpt-6.1-sol'];
}

const CodexModelsCache = z.object({
  models: z.array(z.object({
    slug: z.string(),
    visibility: z.string().optional(),
    priority: z.number().optional(),
  })),
});

/** Models the Codex CLI offers this account, from the catalog it fetches and
 *  caches in `$CODEX_HOME/models_cache.json`: visible ones only, in the CLI's
 *  priority order. [] when the file is missing or unreadable. */
export function readCodexCachedModels(env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    const raw = JSON.parse(readFileSync(join(codexHome(env), 'models_cache.json'), 'utf8'));
    const parsed = CodexModelsCache.safeParse(raw);
    if (!parsed.success) return [];
    return parsed.data.models
      .filter((m) => m.visibility !== 'hide')
      .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER))
      .map((m) => m.slug);
  } catch {
    return [];
  }
}

/** Default model the user picked in Codex (`model = "…"` in
 *  `$CODEX_HOME/config.toml`). Light regex parse — no TOML dependency;
 *  null on any error (missing file, no model line). */
export function readCodexDefaultModel(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const text = readFileSync(join(codexHome(env), 'config.toml'), 'utf8');
    const match = text.match(/^\s*model\s*=\s*"([^"]+)"/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
