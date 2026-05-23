import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';
import { KeyVaultService } from './key-vault';

let db: DatabaseHandle;

afterEach(() => {
  db?.close();
});

describe('KeyVaultService', () => {
  it('round-trips an openai key (set then get)', () => {
    db = makeTestDb();
    const vault = new KeyVaultService(db);
    vault.setKey('openai', 'sk-test-1234567890');
    expect(vault.getKey('openai')).toBe('sk-test-1234567890');
  });

  it('returns null for a missing key', () => {
    db = makeTestDb();
    const vault = new KeyVaultService(db);
    expect(vault.getKey('openai')).toBeNull();
  });

  it('clearKey removes the key', () => {
    db = makeTestDb();
    const vault = new KeyVaultService(db);
    vault.setKey('openai', 'sk-test-1234567890');
    vault.clearKey('openai');
    expect(vault.getKey('openai')).toBeNull();
  });

  it('setKey overwrites an existing key', () => {
    db = makeTestDb();
    const vault = new KeyVaultService(db);
    vault.setKey('openai', 'sk-old-key-1234');
    vault.setKey('openai', 'sk-new-key-5678');
    expect(vault.getKey('openai')).toBe('sk-new-key-5678');
  });

  it('persists across construction (new vault same db)', () => {
    db = makeTestDb();
    const vault1 = new KeyVaultService(db);
    vault1.setKey('anthropic', 'sk-ant-my-key-9999');
    const vault2 = new KeyVaultService(db);
    expect(vault2.getKey('anthropic')).toBe('sk-ant-my-key-9999');
  });

  it('listMasked returns 3 rows in fixed order with hasKey=false when empty', () => {
    db = makeTestDb();
    const vault = new KeyVaultService(db);
    const rows = vault.listMasked();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.transport)).toEqual(['anthropic', 'openai', 'gemini']);
    rows.forEach((r) => {
      expect(r.hasKey).toBe(false);
      expect(r.masked).toBeNull();
      expect(r.updatedAt).toBeNull();
    });
  });

  it('listMasked reports masked key after set (format: sk-…2345)', () => {
    db = makeTestDb();
    const vault = new KeyVaultService(db);
    vault.setKey('openai', 'sk-test-12345');
    const rows = vault.listMasked();
    const openaiRow = rows.find((r) => r.transport === 'openai')!;
    expect(openaiRow.hasKey).toBe(true);
    expect(openaiRow.masked).toBe('sk-…2345');
    expect(openaiRow.updatedAt).not.toBeNull();
  });

  it('short key (<=8 chars) uses *** mask', () => {
    db = makeTestDb();
    const vault = new KeyVaultService(db);
    vault.setKey('gemini', 'short');
    const rows = vault.listMasked();
    const geminiRow = rows.find((r) => r.transport === 'gemini')!;
    expect(geminiRow.hasKey).toBe(true);
    expect(geminiRow.masked).toBe('***');
  });

  it('corrupted authTag → getKey returns null and listMasked reports hasKey=false', () => {
    db = makeTestDb();
    const vault = new KeyVaultService(db);
    vault.setKey('anthropic', 'sk-real-key-xxxx');
    // Corrupt the auth_tag via raw SQL
    db.prepare(
      `UPDATE provider_keys SET auth_tag = X'deadbeefdeadbeefdeadbeef' WHERE transport = 'anthropic'`,
    ).run();
    expect(vault.getKey('anthropic')).toBeNull();
    const rows = vault.listMasked();
    const anthropicRow = rows.find((r) => r.transport === 'anthropic')!;
    expect(anthropicRow.hasKey).toBe(false);
    expect(anthropicRow.masked).toBeNull();
  });

  it('buildInfoRows with CLI present → detected', () => {
    db = makeTestDb();
    const vault = new KeyVaultService(db);
    const rows = vault.buildInfoRows({ anthropicCliPresent: true, ollamaHost: 'http://localhost:11434' });
    const anthropicRow = rows.find((r) => r.transport === 'anthropic-oauth')!;
    expect(anthropicRow.label).toBe('Anthropic OAuth (via claude CLI)');
    expect(anthropicRow.status).toBe('detected');
  });

  it("buildInfoRows with CLI absent → 'no CLI on PATH'", () => {
    db = makeTestDb();
    const vault = new KeyVaultService(db);
    const rows = vault.buildInfoRows({ anthropicCliPresent: false, ollamaHost: 'http://localhost:11434' });
    const anthropicRow = rows.find((r) => r.transport === 'anthropic-oauth')!;
    expect(anthropicRow.status).toBe('no CLI on PATH');
    const ollamaRow = rows.find((r) => r.transport === 'ollama')!;
    expect(ollamaRow.label).toBe('Ollama');
    expect(ollamaRow.status).toBe('Host: http://localhost:11434');
  });
});
