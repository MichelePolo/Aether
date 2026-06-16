import { Cron } from 'croner';

export type Cadence =
  | { kind: 'cron'; expr: string }
  | { kind: 'interval'; everyMs: number };

/** Next fire time (ms epoch) strictly after `fromMs`. Throws on an invalid cron expr. */
export function computeNextRunAt(cadence: Cadence, fromMs: number): number {
  if (cadence.kind === 'interval') return fromMs + cadence.everyMs;
  const next = new Cron(cadence.expr).nextRun(new Date(fromMs));
  if (!next) throw new Error(`cron expression has no next run: ${cadence.expr}`);
  return next.getTime();
}

export function isValidCron(expr: string): boolean {
  try {
    return new Cron(expr).nextRun() !== null;
  } catch {
    return false;
  }
}
