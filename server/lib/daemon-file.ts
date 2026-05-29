import fs from 'node:fs';
import path from 'node:path';

export interface DaemonInfo {
  pid: number;
  host: string;
  port: number;
  startedAt: string;
}

export function daemonFilePath(dataDir: string): string {
  return path.join(dataDir, 'daemon.json');
}

export function writeDaemonFile(dataDir: string, info: DaemonInfo): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(daemonFilePath(dataDir), JSON.stringify(info), 'utf8');
}

export function readDaemonFile(dataDir: string): DaemonInfo | null {
  try {
    const raw = fs.readFileSync(daemonFilePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as DaemonInfo;
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDaemonFile(dataDir: string): void {
  try {
    fs.unlinkSync(daemonFilePath(dataDir));
  } catch {
    // already gone — fine
  }
}
