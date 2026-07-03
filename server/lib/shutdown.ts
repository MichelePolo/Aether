/**
 * Wires SIGTERM/SIGINT so the process exits cleanly in BOTH daemon and
 * non-daemon mode. Historically only the daemon path called
 * `process.exit()`; a plain `npm run dev`/`npm start` registered signal
 * handlers that only stopped the scheduler, which overrides Node's default
 * terminate-on-signal behavior and left the process hanging (the HTTP
 * server keeps the event loop alive).
 *
 * Extracted as a pure function so the handler logic is unit-testable
 * without booting the whole app (importing server/index.ts runs
 * `bootstrap()` as a side effect).
 */

export interface ShutdownDeps {
  isDaemon: boolean;
  server: { close(cb: () => void): void };
  scheduler: { stop(): void };
  dataDir: string;
  exit: (code: number) => void;
  clearDaemonFile: (dataDir: string) => void;
  onSignal: (signal: 'SIGTERM' | 'SIGINT', handler: () => void) => void;
  /** Defaults to global setTimeout; overridable so tests don't need real timers. */
  setTimeout?: (cb: () => void, ms: number) => { unref(): void };
  onExit?: (handler: () => void) => void;
}

/** Builds the shutdown handler and registers it for SIGTERM/SIGINT (+ `exit` for daemon cleanup). */
export function installShutdown(deps: ShutdownDeps): () => void {
  const scheduleTimeout = deps.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));

  const shutdown = () => {
    deps.scheduler.stop();
    if (deps.isDaemon) deps.clearDaemonFile(deps.dataDir);
    deps.server.close(() => deps.exit(0));
    // Failsafe: exit even if a socket lingers (e.g. a keep-alive connection).
    scheduleTimeout(() => deps.exit(0), 2000).unref();
  };

  deps.onSignal('SIGTERM', shutdown);
  deps.onSignal('SIGINT', shutdown);

  if (deps.isDaemon && deps.onExit) {
    deps.onExit(() => deps.clearDaemonFile(deps.dataDir));
  }

  return shutdown;
}
