import os from 'node:os';
import path from 'node:path';
import { mkdirSync, accessSync, constants } from 'node:fs';

export interface LibraryDirOpts {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}

/**
 * Ensure `dir` exists and is writable, creating it (recursively) if needed.
 * Throws a clear, actionable error if creation or the write check fails — so a
 * misconfigured AETHER_LIBRARY_DIR fails fast at boot with a readable message
 * instead of an opaque EACCES stack trace deep in the skills setup.
 */
export function assertWritableDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Aether library directory is not usable: ${dir} (${reason}). ` +
      `Set AETHER_LIBRARY_DIR to a writable path.`,
    );
  }
}

/**
 * Resolve the default per-user library directory using OS app-data conventions.
 * `AETHER_LIBRARY_DIR` (handled in config) overrides this entirely.
 * Options are injectable so the resolver is testable on any host OS.
 */
export function defaultLibraryDir(opts: LibraryDirOpts = {}): string {
  const platform = opts.platform ?? os.platform();
  const env = opts.env ?? process.env;
  const home = opts.homedir ?? os.homedir();

  if (platform === 'win32') {
    const appData = env.APPDATA && env.APPDATA.trim() !== ''
      ? env.APPDATA
      : path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Aether');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Aether');
  }
  const xdg = env.XDG_DATA_HOME && env.XDG_DATA_HOME.trim() !== ''
    ? env.XDG_DATA_HOME
    : path.join(home, '.local', 'share');
  return path.join(xdg, 'aether');
}
