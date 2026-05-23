import { describe, it, expect } from 'vitest';
import { deriveKey, encrypt, decrypt } from './key-crypto';

describe('deriveKey', () => {
  it('returns a 32-byte buffer', () => {
    const k = deriveKey();
    expect(k.length).toBe(32);
  });

  it('is deterministic (same input → same output)', () => {
    const a = deriveKey();
    const b = deriveKey();
    expect(a.equals(b)).toBe(true);
  });
});

describe('encrypt + decrypt', () => {
  it('roundtrips a string', () => {
    const blob = encrypt('hello-secret-key');
    const back = decrypt(blob);
    expect(back).toBe('hello-secret-key');
  });

  it('two encrypts of the same plaintext produce different ciphertext + IV', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('decrypt throws when ciphertext is tampered', () => {
    const blob = encrypt('hello');
    blob.ciphertext[0] = blob.ciphertext[0] ^ 0xff;
    expect(() => decrypt(blob)).toThrow();
  });

  it('decrypt throws when auth tag is tampered', () => {
    const blob = encrypt('hello');
    blob.authTag[0] = blob.authTag[0] ^ 0xff;
    expect(() => decrypt(blob)).toThrow();
  });

  it('roundtrips an empty string', () => {
    const blob = encrypt('');
    expect(decrypt(blob)).toBe('');
  });
});
