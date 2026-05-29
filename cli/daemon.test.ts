import { describe, it, expect, vi } from 'vitest';
import { startDaemon, statusDaemon, stopDaemon, type DaemonDeps } from './daemon';

function deps(over: Partial<DaemonDeps>): DaemonDeps {
  return {
    spawn: vi.fn(() => ({ pid: 4242, unref: vi.fn() })),
    health: vi.fn(async () => true),
    readInfo: vi.fn(() => null),
    clearInfo: vi.fn(),
    kill: vi.fn(),
    sleep: vi.fn(async () => {}),
    baseUrl: 'http://127.0.0.1:3000',
    serverEntry: '/repo/dist/server.cjs',
    port: 3000,
    ...over,
  };
}

describe('startDaemon', () => {
  it('returns already=true when health already responds', async () => {
    const d = deps({
      readInfo: vi.fn(() => ({ pid: 1, host: '127.0.0.1', port: 3000, startedAt: 'x' })),
      health: vi.fn(async () => true),
    });
    const r = await startDaemon(d);
    expect(r.already).toBe(true);
    expect(d.spawn).not.toHaveBeenCalled();
  });

  it('returns already=true when the port is healthy even without a daemon.json', async () => {
    const d = deps({ readInfo: vi.fn(() => null), health: vi.fn(async () => true) });
    const r = await startDaemon(d);
    expect(r.already).toBe(true);
    expect(d.spawn).not.toHaveBeenCalled();
  });

  it('spawns detached and polls health when not running', async () => {
    const calls = [false, false, true];
    const d = deps({ health: vi.fn(async () => calls.shift() ?? true) });
    const r = await startDaemon(d);
    expect(d.spawn).toHaveBeenCalledTimes(1);
    expect(r.already).toBe(false);
    expect(r.pid).toBe(4242);
  });

  it('throws if health never comes up within the attempts', async () => {
    const d = deps({ health: vi.fn(async () => false) });
    await expect(startDaemon(d, { attempts: 3 })).rejects.toThrow(/did not become healthy/i);
  });
});

describe('statusDaemon', () => {
  it('reports running when info present and health ok', async () => {
    const d = deps({
      readInfo: vi.fn(() => ({ pid: 7, host: '127.0.0.1', port: 3000, startedAt: 'x' })),
      health: vi.fn(async () => true),
    });
    expect(await statusDaemon(d)).toMatchObject({ running: true, pid: 7, port: 3000 });
  });

  it('reports not running when no info', async () => {
    expect(await statusDaemon(deps({}))).toMatchObject({ running: false });
  });
});

describe('stopDaemon', () => {
  it('kills the pid and clears the file', async () => {
    const d = deps({
      readInfo: vi.fn(() => ({ pid: 99, host: '127.0.0.1', port: 3000, startedAt: 'x' })),
    });
    const r = await stopDaemon(d);
    expect(d.kill).toHaveBeenCalledWith(99);
    expect(d.clearInfo).toHaveBeenCalled();
    expect(r).toBe(true);
  });

  it('returns false when nothing is running', async () => {
    expect(await stopDaemon(deps({}))).toBe(false);
  });
});
