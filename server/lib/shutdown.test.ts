import { describe, it, expect, vi } from 'vitest';
import { installShutdown } from './shutdown';

function makeDeps(overrides: Partial<Parameters<typeof installShutdown>[0]> = {}) {
  const signalHandlers = new Map<string, () => void>();
  const exitHandlers: Array<() => void> = [];
  const server = { close: vi.fn((cb: () => void) => cb()) };
  const scheduler = { stop: vi.fn() };
  const exit = vi.fn();
  const clearDaemonFile = vi.fn();
  const fakeTimeout = { unref: vi.fn() };
  const setTimeoutSpy = vi.fn((_cb: () => void, _ms: number) => fakeTimeout);

  const deps = {
    isDaemon: false,
    server,
    scheduler,
    dataDir: '/data',
    exit,
    clearDaemonFile,
    onSignal: (sig: 'SIGTERM' | 'SIGINT', handler: () => void) => {
      signalHandlers.set(sig, handler);
    },
    onExit: (handler: () => void) => {
      exitHandlers.push(handler);
    },
    setTimeout: setTimeoutSpy,
    ...overrides,
  };

  return { deps, signalHandlers, exitHandlers, server, scheduler, exit, clearDaemonFile, setTimeoutSpy };
}

describe('installShutdown', () => {
  it('registers a handler for SIGTERM and SIGINT', () => {
    const { deps, signalHandlers } = makeDeps();
    installShutdown(deps);
    expect(signalHandlers.has('SIGTERM')).toBe(true);
    expect(signalHandlers.has('SIGINT')).toBe(true);
  });

  it('non-daemon: invoking the handler stops the scheduler, closes the server, and exits(0)', () => {
    const { deps, signalHandlers, server, scheduler, exit, clearDaemonFile } = makeDeps({ isDaemon: false });
    installShutdown(deps);

    signalHandlers.get('SIGTERM')!();

    expect(scheduler.stop).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(clearDaemonFile).not.toHaveBeenCalled();
  });

  it('non-daemon: does not register an exit handler', () => {
    const { deps, exitHandlers } = makeDeps({ isDaemon: false });
    installShutdown(deps);
    expect(exitHandlers).toHaveLength(0);
  });

  it('daemon: invoking the handler also clears the daemon file, and registers an exit-cleanup handler', () => {
    const { deps, signalHandlers, server, exit, clearDaemonFile, exitHandlers } = makeDeps({ isDaemon: true });
    installShutdown(deps);

    expect(exitHandlers).toHaveLength(1);

    signalHandlers.get('SIGINT')!();

    expect(clearDaemonFile).toHaveBeenCalledWith('/data');
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);

    // The `exit`-event handler itself also clears the daemon file (failsafe
    // for exits not driven through this shutdown function).
    exitHandlers[0]();
    expect(clearDaemonFile).toHaveBeenCalledTimes(2);
  });

  it('installs a 2s unref failsafe timeout that also exits(0)', () => {
    const { deps, signalHandlers, exit, setTimeoutSpy } = makeDeps();
    installShutdown(deps);

    signalHandlers.get('SIGTERM')!();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    const [timeoutCb] = setTimeoutSpy.mock.calls[0];
    exit.mockClear();
    timeoutCb();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
