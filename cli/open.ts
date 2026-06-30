import { spawn } from 'node:child_process';

/**
 * Open a URL in the default browser, cross-platform. Best-effort: failures
 * (headless/SSH, missing opener) are swallowed — callers still print the URL.
 */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [cmd, args]: [string, string[]] =
    platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => { /* non-fatal */ });
    child.unref();
  } catch {
    /* non-fatal */
  }
}
