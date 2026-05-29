import path from 'node:path';
import { readDaemonFile } from '@/server/lib/daemon-file';

export function dataDir(): string {
  return process.env.AETHER_DATA_DIR ?? path.resolve(process.cwd(), 'data');
}

export interface Endpoint {
  host: string;
  port: number;
  baseUrl: string;
}

export function resolveEndpoint(opts: { port?: number }): Endpoint {
  const info = readDaemonFile(dataDir());
  const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;

  const port =
    opts.port ??
    info?.port ??
    (envPort && Number.isFinite(envPort) && envPort > 0 ? envPort : undefined) ??
    3000;
  const host = info?.host ?? '127.0.0.1';

  return { host, port, baseUrl: `http://${host}:${port}` };
}
