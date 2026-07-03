import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { loadOrCreateVaultKey, encrypt, decrypt, deriveLegacyKey, resetKeyCache } from './key-crypto';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aether-vault-'));
}

describe('vault key', () => {
  beforeEach(() => resetKeyCache());

  it('creates a 32-byte key file once and reuses it', () => {
    const dir = tmpDir();
    const k1 = loadOrCreateVaultKey(dir);
    expect(k1).toHaveLength(32);
    expect(fs.existsSync(path.join(dir, '.vault.key'))).toBe(true);
    resetKeyCache();
    const k2 = loadOrCreateVaultKey(dir);
    expect(k2.equals(k1)).toBe(true); // stable across loads
  });

  it('round-trips a secret and travels with the key file (cross-machine sim)', () => {
    const dir = tmpDir();
    const key = loadOrCreateVaultKey(dir);
    const blob = encrypt('sk-secret', key);
    // Simulate a second machine that only has the synced dir (same key file):
    resetKeyCache();
    const key2 = loadOrCreateVaultKey(dir);
    expect(decrypt(blob, key2)).toBe('sk-secret');
  });

  it('honors AETHER_VAULT_KEY override', () => {
    const dir = tmpDir();
    const hex = 'aa'.repeat(32);
    process.env.AETHER_VAULT_KEY = hex;
    try {
      const key = loadOrCreateVaultKey(dir);
      expect(key.toString('hex')).toBe(hex);
      expect(fs.existsSync(path.join(dir, '.vault.key'))).toBe(false); // override does not write a file
    } finally {
      delete process.env.AETHER_VAULT_KEY;
      resetKeyCache();
    }
  });

  it('rejects an AETHER_VAULT_KEY that is not 32 bytes of hex', () => {
    process.env.AETHER_VAULT_KEY = 'not-hex-and-too-short';
    try {
      expect(() => loadOrCreateVaultKey(tmpDir())).toThrow();
    } finally {
      delete process.env.AETHER_VAULT_KEY;
      resetKeyCache();
    }
  });

  it('caches the loaded key across calls without re-reading the file', () => {
    const dir = tmpDir();
    const k1 = loadOrCreateVaultKey(dir);
    // Even if the file changed on disk, the cached in-memory key is returned.
    fs.writeFileSync(path.join(dir, '.vault.key'), Buffer.alloc(32, 9), { mode: 0o600 });
    const k2 = loadOrCreateVaultKey(dir);
    expect(k2.equals(k1)).toBe(true);
  });

  it('throws on a corrupt (wrong-length) key file', () => {
    const dir = tmpDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.vault.key'), Buffer.from('too-short'));
    expect(() => loadOrCreateVaultKey(dir)).toThrow();
  });
});

describe('deriveLegacyKey', () => {
  it('returns a deterministic 32-byte buffer', () => {
    const a = deriveLegacyKey();
    const b = deriveLegacyKey();
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
  });
});

describe('encrypt + decrypt', () => {
  const key = Buffer.alloc(32, 1);

  it('roundtrips a string', () => {
    const blob = encrypt('hello-secret-key', key);
    expect(decrypt(blob, key)).toBe('hello-secret-key');
  });

  it('two encrypts of the same plaintext produce different ciphertext + IV', () => {
    const a = encrypt('same', key);
    const b = encrypt('same', key);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('decrypt throws when ciphertext is tampered', () => {
    const blob = encrypt('hello', key);
    blob.ciphertext[0] = blob.ciphertext[0] ^ 0xff;
    expect(() => decrypt(blob, key)).toThrow();
  });

  it('decrypt throws when auth tag is tampered', () => {
    const blob = encrypt('hello', key);
    blob.authTag[0] = blob.authTag[0] ^ 0xff;
    expect(() => decrypt(blob, key)).toThrow();
  });

  it('decrypt throws when given the wrong key', () => {
    const blob = encrypt('hello', key);
    const otherKey = Buffer.alloc(32, 2);
    expect(() => decrypt(blob, otherKey)).toThrow();
  });

  it('roundtrips an empty string', () => {
    const blob = encrypt('', key);
    expect(decrypt(blob, key)).toBe('');
  });
});
