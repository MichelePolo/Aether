import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveEndpoint } from './config';

let dir: string;
const ORIG = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-cfg-'));
  process.env.AETHER_DATA_DIR = dir;
  delete process.env.PORT;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

describe('resolveEndpoint', () => {
  it('defaults to 127.0.0.1:3000 when nothing is set', () => {
    expect(resolveEndpoint({})).toEqual({
      host: '127.0.0.1',
      port: 3000,
      baseUrl: 'http://127.0.0.1:3000',
    });
  });

  it('uses PORT env over the default', () => {
    process.env.PORT = '4100';
    expect(resolveEndpoint({}).port).toBe(4100);
  });

  it('uses daemon.json over PORT env', () => {
    process.env.PORT = '4100';
    fs.writeFileSync(
      path.join(dir, 'daemon.json'),
      JSON.stringify({ pid: 1, host: '127.0.0.1', port: 4222, startedAt: 'x' }),
    );
    expect(resolveEndpoint({}).port).toBe(4222);
  });

  it('uses opts.port over everything', () => {
    process.env.PORT = '4100';
    fs.writeFileSync(
      path.join(dir, 'daemon.json'),
      JSON.stringify({ pid: 1, host: '127.0.0.1', port: 4222, startedAt: 'x' }),
    );
    expect(resolveEndpoint({ port: 5000 }).port).toBe(5000);
  });
});
