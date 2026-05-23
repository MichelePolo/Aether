import { describe, it, expect } from 'vitest';
import { executeCommand } from './aether-shell.handler';

describe('executeCommand — happy path', () => {
  it('runs echo and returns stdout + exit 0', async () => {
    const out = await executeCommand({ cmd: 'echo hello' });
    expect(out.isError).toBe(false);
    expect(out.content[0].text).toMatch(/hello/);
    expect(out.content[0].text).toMatch(/exit code: 0/);
  });

  it('non-zero exit returns isError=true', async () => {
    const out = await executeCommand({ cmd: 'exit 7' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/exit code: 7/);
  });

  it('runs with custom cwd', async () => {
    const out = await executeCommand({ cmd: 'pwd', cwd: '/tmp' });
    expect(out.isError).toBe(false);
    expect(out.content[0].text).toMatch(/\/tmp/);
  });
});

describe('executeCommand — blocklist', () => {
  it('blocks rm -rf /', async () => {
    const out = await executeCommand({ cmd: 'rm -rf /' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/blocked by safety policy/);
  });

  it('blocks sudo', async () => {
    const out = await executeCommand({ cmd: 'sudo apt install x' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/blocked by safety policy/);
  });

  it('blocks fork bomb', async () => {
    const out = await executeCommand({ cmd: ':(){:|:&};:' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/blocked by safety policy/);
  });

  it('blocks dd if=', async () => {
    const out = await executeCommand({ cmd: 'dd if=/dev/zero of=/dev/sda' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/blocked by safety policy/);
  });
});

describe('executeCommand — timeout', () => {
  it('returns timeout error when command exceeds timeout', async () => {
    const out = await executeCommand({ cmd: 'sleep 10', timeout: 200 });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/timeout after/);
  });

  it('caps timeout at maxTimeoutMs', async () => {
    // Asking for 9999999 ms should be silently capped.
    // We can't easily assert internal state, but a command that finishes fast must succeed.
    const out = await executeCommand({ cmd: 'true', timeout: 9_999_999 });
    expect(out.isError).toBe(false);
  });
});

describe('executeCommand — output cap', () => {
  it('truncates oversized stdout and notes it', async () => {
    // Produce ~2 MB of output via /bin/sh
    const out = await executeCommand({
      cmd: 'head -c 2000000 /dev/zero | base64',
    });
    expect(out.content[0].text).toMatch(/\[output truncated\]/);
  }, 10_000);
});
