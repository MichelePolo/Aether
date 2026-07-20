import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type CodexAuthMode = 'oauth' | 'none';

export interface CodexEnvOpts {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/**
 * Locate the user-installed `codex` binary by scanning PATH. Unlike `claude`
 * (shipped inside the Agent SDK package), Codex CLI is always a user install,
 * so PATH is the only sensible source. On Windows npm shims are `.cmd`/`.exe`.
 */
export function resolveCodexBinary(opts: CodexEnvOpts = {}): string | null {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const isWindows = platform === 'win32';
  const names = isWindows ? ['codex.exe', 'codex.cmd'] : ['codex'];
  const pathVar = env.PATH ?? env.Path ?? '';
  const separator = isWindows ? ';' : ':';
  for (const dir of pathVar.split(separator)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Codex config/auth root: `$CODEX_HOME` when set, else `~/.codex`. */
export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CODEX_HOME;
  if (override && override.length > 0) return override;
  return join(homedir(), '.codex');
}

/**
 * Codex auth is never handled by Aether: the CLI reads its own credentials
 * from `$CODEX_HOME/auth.json` (written by `codex login`, ChatGPT-subscription
 * OAuth). Detection is therefore purely local — binary on PATH AND auth file
 * present — with no network probe.
 */
export async function detectCodexAuth(opts: CodexEnvOpts = {}): Promise<CodexAuthMode> {
  const env = opts.env ?? process.env;
  if (!resolveCodexBinary(opts)) return 'none';
  return existsSync(join(codexHome(env), 'auth.json')) ? 'oauth' : 'none';
}
