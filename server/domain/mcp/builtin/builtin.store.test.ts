import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { makeTestDb } from '@/server/test/test-db';
import { BuiltinMcpStore } from './builtin.store';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: BuiltinMcpStore;

beforeEach(() => {
  db = makeTestDb();
  store = new BuiltinMcpStore(db);
});

afterEach(() => db.close());

describe('BuiltinMcpStore', () => {
  it('read() returns 2 pre-seeded rows, both disabled', () => {
    const rows = store.read();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.transport).sort()).toEqual(['filesystem', 'git', 'terminal']);
    expect(rows.every((r) => r.enabled === false)).toBe(true);
    expect(rows.every((r) => r.fsRoot === null)).toBe(true);
  });

  it('setEnabled flips the flag', () => {
    store.setEnabled('filesystem', true);
    const fs = store.read().find((r) => r.transport === 'filesystem')!;
    expect(fs.enabled).toBe(true);
  });

  it('setFsRoot persists path; null reverts', () => {
    store.setFsRoot('filesystem', '/tmp');
    expect(store.read().find((r) => r.transport === 'filesystem')!.fsRoot).toBe('/tmp');
    store.setFsRoot('filesystem', null);
    expect(store.read().find((r) => r.transport === 'filesystem')!.fsRoot).toBeNull();
  });

  it('toConfigs() returns only enabled rows', () => {
    expect(store.toConfigs('/cwd')).toEqual([]);
    store.setEnabled('filesystem', true);
    const configs = store.toConfigs('/cwd');
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe('builtin:filesystem');
  });

  it('toConfigs() resolves fsRoot ?? defaultCwd', () => {
    store.setEnabled('filesystem', true);
    let configs = store.toConfigs('/default');
    expect(configs[0].args).toContain('/default');
    store.setFsRoot('filesystem', '/custom');
    configs = store.toConfigs('/default');
    expect(configs[0].args).toContain('/custom');
    expect(configs[0].args).not.toContain('/default');
  });

  it('toConfigs() for terminal omits fsRoot', () => {
    store.setEnabled('terminal', true);
    const configs = store.toConfigs('/default');
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe('builtin:terminal');
    expect(configs[0].args).not.toContain('/default');
  });

  // Regression for the "Terminal can't be turned on" bug: the resolved command
  // + args must launch a real process that speaks MCP — not crash on startup
  // (e.g. `node aether-shell.ts` → ERR_UNKNOWN_FILE_EXTENSION). Mechanism-agnostic:
  // we only assert the process initializes, never HOW it's launched.
  it('terminal config launches a working MCP process', async () => {
    store.setEnabled('terminal', true);
    const cfg = store.toConfigs('/cwd').find((c) => c.id === 'builtin:terminal')!;

    const line = await new Promise<string>((resolve, reject) => {
      const proc = spawn(cfg.command!, cfg.args ?? []); // default stdio: pipe (non-null streams)
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`timed out waiting for MCP response. stderr:\n${err}`));
      }, 12_000);
      proc.stdout.on('data', (d: Buffer) => {
        out += d.toString();
        const nl = out.indexOf('\n');
        if (nl >= 0) {
          clearTimeout(timer);
          proc.kill();
          resolve(out.slice(0, nl));
        }
      });
      proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
      proc.on('error', reject);
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n');
    });

    const parsed = JSON.parse(line) as { result?: { serverInfo?: { name?: string } } };
    expect(parsed.result?.serverInfo?.name).toBe('aether-shell');
  }, 15_000);
});

describe('BuiltinMcpStore — git transport (slice 28)', () => {
  it('seeds a disabled git row', () => {
    const git = store.read().find((r) => r.transport === 'git');
    expect(git).toBeDefined();
    expect(git!.enabled).toBe(false);
    expect(git!.fsRoot).toBeNull();
  });

  it('toConfigs includes a Git config when enabled, rooted at the last arg', () => {
    store.setEnabled('git', true);
    const configs = store.toConfigs('/tmp/work');
    const git = configs.find((c) => c.id === 'builtin:git');
    expect(git).toBeDefined();
    expect(git!.name).toBe('Git');
    const args = git!.args ?? [];
    expect(args[args.length - 1]).toBe('/tmp/work');
  });
});
