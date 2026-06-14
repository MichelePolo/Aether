import { computeNextRunAt, isValidCron } from './next-run';

describe('next-run', () => {
  it('interval: from + everyMs', () => {
    expect(computeNextRunAt({ kind: 'interval', everyMs: 3600_000 }, 1000)).toBe(3601_000);
  });

  it('cron: next daily 03:00 is strictly after `from`', () => {
    // 2026-06-14T10:00:00Z
    const from = Date.UTC(2026, 5, 14, 10, 0, 0);
    const next = computeNextRunAt({ kind: 'cron', expr: '0 3 * * *' }, from);
    expect(next).toBeGreaterThan(from);
    // next 03:00 local is within ~24h
    expect(next - from).toBeLessThanOrEqual(24 * 3600_000 + 1000);
  });

  it('isValidCron', () => {
    expect(isValidCron('0 3 * * *')).toBe(true);
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });
});
