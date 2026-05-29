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
  // Spawn the server from source via tsx (same runtime as `npm run dev`).
  // The production bundle (dist/server.cjs) is not self-contained, so the
  // daemon runs the TypeScript entrypoint directly.
  const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
  return {
    spawn: (entry, env) => {
      const child = nodeSpawn(tsxBin, [entry], {
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
    serverEntry: path.resolve(process.cwd(), 'server', 'index.ts'),
    port: ep.port,
  };
}
