import { query } from '@anthropic-ai/claude-agent-sdk';
import { resolveClaudeCodeExecutable } from '@/server/lib/claude-code-executable';

export interface AnthropicOAuthModelsOpts {
  /** Same auth env the Anthropic provider hands its spawned `claude`. */
  resolveAuthEnv?: () => Record<string, string>;
  timeoutMs?: number;
  /** Test seam. */
  queryImpl?: typeof query;
}

/**
 * `claude-opus-5[1m]` → `claude-opus-5`, `claude-haiku-4-5-20251001` → `claude-haiku-4-5`,
 * so live IDs dedupe against the hardcoded catalog and sessions pinned to it.
 * Aliases without a concrete model (`default`, `sonnet`) yield null.
 */
export function canonicalModelId(raw: string): string | null {
  const id = raw.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
  return id.startsWith('claude-') ? id : null;
}

/**
 * Asks the Claude Agent SDK which models the subscription can use. The list
 * comes from the bundled Claude Code, so it tracks new releases with an SDK bump
 * instead of a code change. No prompt is sent: the session opens on an idle input
 * stream, answers the control request, and is closed. Returns [] on any failure
 * so the caller can fall back to the hardcoded catalog.
 */
export async function discoverAnthropicOAuthModels(opts: AnthropicOAuthModelsOpts = {}): Promise<string[]> {
  let release!: () => void;
  const idle = new Promise<void>((resolve) => { release = resolve; });
  async function* noMessages(): AsyncGenerator<never> {
    await idle;
  }

  const options: Record<string, unknown> = { tools: [], settingSources: [], maxTurns: 1 };
  const executable = resolveClaudeCodeExecutable();
  if (executable) options.pathToClaudeCodeExecutable = executable;
  const authEnv = opts.resolveAuthEnv?.();
  if (authEnv && Object.keys(authEnv).length > 0) options.env = { ...process.env, ...authEnv };

  let timer: NodeJS.Timeout | undefined;
  let session: ReturnType<typeof query> | undefined;
  try {
    session = (opts.queryImpl ?? query)({ prompt: noMessages(), options } as Parameters<typeof query>[0]);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('supportedModels timed out')), opts.timeoutMs ?? 15_000);
    });
    const models = await Promise.race([session.supportedModels(), timeout]);
    const ids = models.map((m) => canonicalModelId(m.resolvedModel ?? m.value));
    return [...new Set(ids.filter((id): id is string => id !== null))];
  } catch (err) {
    console.warn(`[providers] Anthropic OAuth model discovery failed, using built-in catalog: ${(err as Error).message}`);
    return [];
  } finally {
    clearTimeout(timer);
    release();
    session?.close();
  }
}
