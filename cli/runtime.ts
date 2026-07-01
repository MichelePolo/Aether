import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDaemonFile, clearDaemonFile } from '@/server/lib/daemon-file';
import { dataDir, resolveEndpoint } from './config';
import type { DaemonDeps, SpawnedChild } from './daemon';

// Directory of the CLI bundle itself (dist/cli.cjs). The server bundle is its
// sibling (dist/server.cjs). Resolving relative to import.meta.url — not
// process.cwd() — lets `aether` be installed globally and run from any dir.
const bundleDir = path.dirname(fileURLToPath(import.meta.url));

export async function defaultHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export function defaultDeps(opts: { port?: number }): DaemonDeps {
  const ep = resolveEndpoint(opts);
  const dir = dataDir();
  // Spawn the production server bundle (built by `npm run build`, shipped next to
  // the CLI bundle in dist/). Runnable via the import.meta.url shim + migrations
  // copied to dist/.
  return {
    spawn: (entry, env) => {
      const child = nodeSpawn('node', [entry], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...env },
      });
      return child as SpawnedChild;
    },
    health: defaultHealth,
    readInfo: () => readDaemonFile(dir),
    clearInfo: () => clearDaemonFile(dir),
    kill: (pid) => process.kill(pid, 'SIGTERM'),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    baseUrl: ep.baseUrl,
    serverEntry: path.resolve(bundleDir, 'server.cjs'),
    port: ep.port,
  };
}
