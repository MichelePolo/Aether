import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import os from 'node:os';

const SALT = Buffer.from('aether-key-vault-salt-v1', 'utf-8');
const KEY_LEN = 32;          // AES-256
const IV_LEN = 12;           // GCM standard
const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

let cachedKey: Buffer | null = null;

export function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const seed = `${os.hostname()}|${os.userInfo().username}`;
  cachedKey = scryptSync(seed, SALT, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return cachedKey;
}

export function encrypt(plaintext: string): EncryptedBlob {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decrypt(blob: EncryptedBlob): string {
  const key = deriveKey();
  const decipher = createDecipheriv('aes-256-gcm', key, blob.iv);
  decipher.setAuthTag(blob.authTag);
  const out = Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
  return out.toString('utf-8');
}
