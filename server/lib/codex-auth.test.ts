import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCodexBinary, codexHome, detectCodexAuth } from './codex-auth';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codex-auth-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveCodexBinary', () => {
  it('finds codex on PATH (posix)', () => {
    const bin = join(dir, 'codex');
    writeFileSync(bin, '#!/bin/sh\n');
    expect(resolveCodexBinary({ env: { PATH: `/nonexistent:${dir}` }, platform: 'linux' })).toBe(bin);
  });

  it('returns null when absent', () => {
    expect(resolveCodexBinary({ env: { PATH: dir }, platform: 'linux' })).toBeNull();
  });

  it('finds Windows npm shims (codex.cmd) with ; separator', () => {
    const bin = join(dir, 'codex.cmd');
    writeFileSync(bin, '@echo off\n');
    expect(resolveCodexBinary({ env: { PATH: `C:\\nope;${dir}` }, platform: 'win32' })).toBe(bin);
  });

  it('prefers codex.exe over codex.cmd on Windows', () => {
    writeFileSync(join(dir, 'codex.cmd'), '');
    writeFileSync(join(dir, 'codex.exe'), '');
    expect(resolveCodexBinary({ env: { PATH: dir }, platform: 'win32' })).toBe(join(dir, 'codex.exe'));
  });

  it('handles empty PATH', () => {
    expect(resolveCodexBinary({ env: {}, platform: 'linux' })).toBeNull();
  });
});

describe('codexHome', () => {
  it('respects CODEX_HOME override', () => {
    expect(codexHome({ CODEX_HOME: '/custom/codex' })).toBe('/custom/codex');
  });

  it('defaults to ~/.codex', () => {
    expect(codexHome({})).toMatch(/[/\\]\.codex$/);
  });
});

describe('detectCodexAuth', () => {
  it('oauth when binary on PATH and auth.json exists', async () => {
    const binDir = join(dir, 'bin');
    const home = join(dir, 'home');
    mkdirSync(binDir);
    mkdirSync(home);
    writeFileSync(join(binDir, 'codex'), '');
    writeFileSync(join(home, 'auth.json'), '{}');
    const result = await detectCodexAuth({
      env: { PATH: binDir, CODEX_HOME: home },
      platform: 'linux',
    });
    expect(result).toBe('oauth');
  });

  it('none when binary missing even if auth.json exists', async () => {
    const home = join(dir, 'home');
    mkdirSync(home);
    writeFileSync(join(home, 'auth.json'), '{}');
    const result = await detectCodexAuth({
      env: { PATH: join(dir, 'empty'), CODEX_HOME: home },
      platform: 'linux',
    });
    expect(result).toBe('none');
  });

  it('none when logged out (no auth.json)', async () => {
    const binDir = join(dir, 'bin');
    const home = join(dir, 'home');
    mkdirSync(binDir);
    mkdirSync(home);
    writeFileSync(join(binDir, 'codex'), '');
    const result = await detectCodexAuth({
      env: { PATH: binDir, CODEX_HOME: home },
      platform: 'linux',
    });
    expect(result).toBe('none');
  });
});
