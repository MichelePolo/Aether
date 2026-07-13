import { query } from '@anthropic-ai/claude-agent-sdk';
import { resolveClaudeCodeExecutable } from './claude-code-executable';

type AuthMode = 'oauth' | 'apikey' | 'none';

// Windows può richiedere più tempo al cold-start e in ufficio la rete passa
// spesso da un proxy: timeout più generosi evitano falsi 'none' al boot.
const isWindows = process.platform === 'win32';
const SDK_PROBE_TIMEOUT_MS = isWindows ? 12_000 : 5_000;

export async function detectAnthropicAuth(): Promise<AuthMode> {
  if (typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.length > 0) {
    return 'apikey';
  }

  // Do not gate OAuth on an external `claude` command being on PATH. Explorer-
  // launched Windows apps inherit a different PATH from npm/Git Bash, while the
  // Agent SDK bundled with Aether can itself load the user's Claude Code OAuth
  // credentials. The actual SDK probe is the authoritative test.
  const probeOk = await probeOAuth();
  return probeOk ? 'oauth' : 'none';
}

async function probeOAuth(): Promise<boolean> {
  const aborter = new AbortController();
  const claudeCodeExecutable = resolveClaudeCodeExecutable();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      aborter.abort();
      resolve(false);
    }, SDK_PROBE_TIMEOUT_MS);
  });

  const iterationPromise = (async (): Promise<boolean> => {
    try {
      const iter = query({
        prompt: 'ping',
        options: {
          model: 'claude-haiku-4-5',
          maxTurns: 1,
          allowedTools: [],
          abortController: aborter,
          ...(claudeCodeExecutable
            ? { pathToClaudeCodeExecutable: claudeCodeExecutable }
            : {}),
        },
      } as Parameters<typeof query>[0]);
      for await (const ev of iter) {
        const msg = ev as { type?: string; error?: string };
        if (msg.type === 'assistant' && typeof msg.error === 'string') {
          return false;
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  })();

  try {
    return await Promise.race([iterationPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    aborter.abort();
  }
}
