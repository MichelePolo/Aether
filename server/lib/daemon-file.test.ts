import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  daemonFilePath,
  writeDaemonFile,
  readDaemonFile,
  clearDaemonFile,
} from './daemon-file';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-daemon-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('daemon-file', () => {
  it('writes then reads back the same info', () => {
    const info = { pid: 123, host: '127.0.0.1', port: 3000, startedAt: '2026-05-29T00:00:00.000Z' };
    writeDaemonFile(dir, info);
    expect(fs.existsSync(daemonFilePath(dir))).toBe(true);
    expect(readDaemonFile(dir)).toEqual(info);
  });

  it('returns null when the file is missing', () => {
    expect(readDaemonFile(dir)).toBeNull();
  });

  it('returns null when the file is corrupt', () => {
    fs.writeFileSync(daemonFilePath(dir), 'not json');
    expect(readDaemonFile(dir)).toBeNull();
  });

  it('clear removes the file and is safe when already absent', () => {
    writeDaemonFile(dir, { pid: 1, host: '127.0.0.1', port: 3000, startedAt: 'x' });
    clearDaemonFile(dir);
    expect(fs.existsSync(daemonFilePath(dir))).toBe(false);
    expect(() => clearDaemonFile(dir)).not.toThrow();
  });
});
