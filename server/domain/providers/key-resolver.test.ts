import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';
import { KeyVaultService } from './key-vault';
import { KeyResolver } from './key-resolver';

let db: DatabaseHandle;

afterEach(() => {
  db?.close();
});

function makeResolver(
  vaultKeys: Partial<Record<'anthropic' | 'openai' | 'gemini', string>> = {},
  env: Partial<{ ANTHROPIC_API_KEY: string; OPENAI_API_KEY: string; GEMINI_API_KEY: string }> = {},
): KeyResolver {
  db = makeTestDb();
  const vault = new KeyVaultService(db);
  for (const [transport, key] of Object.entries(vaultKeys) as [
    'anthropic' | 'openai' | 'gemini',
    string,
  ][]) {
    vault.setKey(transport, key);
  }
  return new KeyResolver({
    vault,
    env: {
      ANTHROPIC_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      ...env,
    },
  });
}

describe('KeyResolver', () => {
  it('returns undefined when neither env nor vault is set', () => {
    const resolver = makeResolver();
    expect(resolver.get('openai')).toBeUndefined();
  });

  it('returns vault key when env is empty', () => {
    const resolver = makeResolver({ openai: 'sk-vault-key-5678' });
    expect(resolver.get('openai')).toBe('sk-vault-key-5678');
  });

  it('env wins over vault', () => {
    const resolver = makeResolver(
      { openai: 'sk-vault-key-5678' },
      { OPENAI_API_KEY: 'sk-env' },
    );
    expect(resolver.get('openai')).toBe('sk-env');
  });

  it('gemini vault key works', () => {
    const resolver = makeResolver({ gemini: 'gemini-vault-key-abcd' });
    expect(resolver.get('gemini')).toBe('gemini-vault-key-abcd');
  });

  it('anthropic vault key works', () => {
    const resolver = makeResolver({ anthropic: 'sk-ant-vault-key-abcd' });
    expect(resolver.get('anthropic')).toBe('sk-ant-vault-key-abcd');
  });

  it('empty string env treated as unset (falls through to vault)', () => {
    const resolver = makeResolver(
      { openai: 'sk-vault-fallback-9999' },
      { OPENAI_API_KEY: '' },
    );
    expect(resolver.get('openai')).toBe('sk-vault-fallback-9999');
  });
});
