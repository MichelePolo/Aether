import { describe, it, expect, vi } from 'vitest';
import { parseExitCode, createRunCommand } from './tdd.run-command';

describe('parseExitCode', () => {
  it('extracts a numeric exit code', () => {
    expect(parseExitCode('out\n---\nerr\n---\nexit code: 0', false)).toBe(0);
    expect(parseExitCode('out\n---\nerr\n---\nexit code: 2', true)).toBe(2);
  });
  it('takes the LAST exit-code occurrence (runner may echo one in its output)', () => {
    expect(parseExitCode('FAIL\nexit code: 0 (runner banner)\n---\n\n---\nexit code: 1', true)).toBe(1);
  });
  it('falls back to isError when no exit code is present (e.g. timeout)', () => {
    expect(parseExitCode('partial\n---\n\n---\ntimeout after 120000ms', true)).toBe(1);
    expect(parseExitCode('whatever', false)).toBe(0);
  });
});

describe('createRunCommand', () => {
  it('runs the command and returns exitCode + full output', async () => {
    const exec = vi.fn(async () => ({
      isError: false,
      content: [{ type: 'text' as const, text: 'all good\n---\n\n---\nexit code: 0' }],
    }));
    const runCommand = createRunCommand(exec);
    const res = await runCommand('npx vitest run', '/repo');
    expect(res).toEqual({ exitCode: 0, output: 'all good\n---\n\n---\nexit code: 0' });
    expect(exec).toHaveBeenCalledWith({ cmd: 'npx vitest run', cwd: '/repo', timeout: 120000 });
  });

  it('reports a failing exit code', async () => {
    const exec = vi.fn(async () => ({
      isError: true,
      content: [{ type: 'text' as const, text: 'FAIL\n---\nboom\n---\nexit code: 1' }],
    }));
    const res = await createRunCommand(exec)('cmd');
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain('FAIL');
  });
});
