import path from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Explorer-launched Electron apps do not inherit the Git Bash/npm PATH used by
 * a terminal. Make the usual per-user Claude Code locations visible only to
 * this process; no system environment variables are changed.
 */
export function configureWindowsClaudeEnvironment({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  if (platform !== 'win32') return;
  const pathApi = path.win32;

  const home = env.USERPROFILE;
  const appData = env.APPDATA ?? (home ? pathApi.join(home, 'AppData', 'Roaming') : undefined);
  const localAppData = env.LOCALAPPDATA ?? (home ? pathApi.join(home, 'AppData', 'Local') : undefined);
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const current = (env[pathKey] ?? '').split(';').filter(Boolean);
  const candidates = [
    appData && pathApi.join(appData, 'npm'),
    localAppData && pathApi.join(localAppData, 'npm'),
    home && pathApi.join(home, '.local', 'bin'),
  ].filter((dir) => typeof dir === 'string' && exists(dir));
  const missing = candidates.filter((dir) => !current.some((entry) => entry.toLowerCase() === dir.toLowerCase()));
  if (missing.length > 0) env[pathKey] = [...missing, ...current].join(';');

  if (!env.CLAUDE_CODE_GIT_BASH_PATH) {
    const bashCandidates = [
      env.ProgramFiles && pathApi.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
      env['ProgramFiles(x86)'] && pathApi.join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    ].filter((file) => typeof file === 'string');
    const bash = bashCandidates.find((file) => exists(file));
    if (bash) env.CLAUDE_CODE_GIT_BASH_PATH = bash;
  }
}
