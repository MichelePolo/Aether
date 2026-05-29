import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { readDaemonFile, clearDaemonFile } from '@/server/lib/daemon-file';
import { dataDir, resolveEndpoint } from './config';
import type { DaemonDeps, SpawnedChild } from './daemon';

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
  // Spawn the production server bundle (built by `npm run build`). The bundle is
  // runnable as of slice 24.1 (import.meta.url shim + migrations copied to dist/).
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
    serverEntry: path.resolve(process.cwd(), 'dist', 'server.cjs'),
    port: ep.port,
  };
}
