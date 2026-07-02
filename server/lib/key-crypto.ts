import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LEGACY_SALT = Buffer.from('aether-key-vault-salt-v1', 'utf-8');
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM standard
const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_FILE = '.vault.key';

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

let cachedKey: Buffer | null = null;

/** Test seam: forget the in-module cached key. */
export function resetKeyCache(): void {
  cachedKey = null;
}

/**
 * Active vault key: AETHER_VAULT_KEY (hex) if set, else a random 32-byte key
 * persisted at `${dataDir}/.vault.key` (mode 0600), created once. Living in the
 * data dir means the key travels with a synced DB (fixes cross-machine key loss).
 */
export function loadOrCreateVaultKey(dataDir: string): Buffer {
  if (cachedKey) return cachedKey;

  const override = process.env.AETHER_VAULT_KEY;
  if (override) {
    const buf = Buffer.from(override, 'hex');
    if (buf.length !== KEY_LEN) {
      throw new Error('AETHER_VAULT_KEY must be 64 hex chars (32 bytes)');
    }
    cachedKey = buf;
    return cachedKey;
  }

  const file = path.join(dataDir, KEY_FILE);
  if (fs.existsSync(file)) {
    const key = fs.readFileSync(file);
    if (key.length !== KEY_LEN) throw new Error(`corrupt vault key file: ${file}`);
    cachedKey = key;
    return cachedKey;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(KEY_LEN);
  fs.writeFileSync(file, key, { mode: 0o600 });
  cachedKey = key;
  return key;
}

/** Legacy hostname-derived key — kept ONLY for one-time migration of old rows. */
export function deriveLegacyKey(): Buffer {
  const seed = `${os.hostname()}|${os.userInfo().username}`;
  return scryptSync(seed, LEGACY_SALT, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
}

export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, blob.iv);
  decipher.setAuthTag(blob.authTag);
  const out = Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
  return out.toString('utf-8');
}
