import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { readDaemonFile, clearDaemonFile, type DaemonInfo } from '@/server/lib/daemon-file';
import { dataDir, resolveEndpoint } from './config';

export interface SpawnedChild {
  pid?: number;
  unref: () => void;
}

export interface DaemonDeps {
  spawn: (entry: string, env: Record<string, string>) => SpawnedChild;
  health: (baseUrl: string) => Promise<boolean>;
  readInfo: () => DaemonInfo | null;
  clearInfo: () => void;
  kill: (pid: number) => void;
  sleep: (ms: number) => Promise<void>;
  baseUrl: string;
  serverEntry: string;
  port: number;
}

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
  return {
    spawn: (entry, env) => {
      const child = nodeSpawn('node', [entry], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...env },
      });
      return child;
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

export interface StartResult {
  already: boolean;
  pid: number;
  port: number;
}

export async function startDaemon(
  d: DaemonDeps,
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<StartResult> {
  const info = d.readInfo();
  if (info && (await d.health(d.baseUrl))) {
    return { already: true, pid: info.pid, port: d.port };
  }

  const child = d.spawn(d.serverEntry, { AETHER_DAEMON: '1', PORT: String(d.port) });
  child.unref();

  const attempts = opts.attempts ?? 20;
  const intervalMs = opts.intervalMs ?? 500;
  for (let i = 0; i < attempts; i++) {
    if (await d.health(d.baseUrl)) {
      return { already: false, pid: child.pid ?? -1, port: d.port };
    }
    await d.sleep(intervalMs);
  }
  throw new Error(`daemon did not become healthy at ${d.baseUrl}`);
}

export interface StatusResult {
  running: boolean;
  pid?: number;
  port?: number;
}

export async function statusDaemon(d: DaemonDeps): Promise<StatusResult> {
  const info = d.readInfo();
  if (!info) return { running: false };
  const running = await d.health(d.baseUrl);
  return running ? { running: true, pid: info.pid, port: info.port } : { running: false };
}

export async function stopDaemon(d: DaemonDeps): Promise<boolean> {
  const info = d.readInfo();
  if (!info) return false;
  try {
    d.kill(info.pid);
  } catch {
    // process already gone
  }
  d.clearInfo();
  return true;
}
