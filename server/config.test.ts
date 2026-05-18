import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('loadConfig', () => {
  it('returns defaults when nothing is set', () => {
    delete process.env.PORT;
    delete process.env.AETHER_DATA_DIR;
    delete process.env.AETHER_FAKE_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    const cfg = loadConfig();
    expect(cfg.port).toBe(3000);
    expect(cfg.dataDir).toMatch(/data$/);
    expect(cfg.fakeProvider).toBe(false);
    expect(cfg.geminiApiKey).toBe('');
  });

  it('reads PORT as integer', () => {
    process.env.PORT = '4321';
    expect(loadConfig().port).toBe(4321);
  });

  it('treats AETHER_FAKE_PROVIDER=1 as true, other values as false', () => {
    process.env.AETHER_FAKE_PROVIDER = '1';
    expect(loadConfig().fakeProvider).toBe(true);
    process.env.AETHER_FAKE_PROVIDER = '0';
    expect(loadConfig().fakeProvider).toBe(false);
    process.env.AETHER_FAKE_PROVIDER = 'true';
    expect(loadConfig().fakeProvider).toBe(false);
  });

  it('reads GEMINI_API_KEY when set', () => {
    process.env.GEMINI_API_KEY = 'abc123';
    expect(loadConfig().geminiApiKey).toBe('abc123');
  });

  it('reads AETHER_DATA_DIR when set', () => {
    process.env.AETHER_DATA_DIR = '/tmp/aether';
    expect(loadConfig().dataDir).toBe('/tmp/aether');
  });
});
