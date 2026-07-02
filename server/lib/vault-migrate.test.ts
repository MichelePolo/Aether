import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';
import { migrateVaultToRandomKey } from './vault-migrate';
import { encrypt, decrypt, deriveLegacyKey, loadOrCreateVaultKey, resetKeyCache } from './key-crypto';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aether-vault-migrate-'));
}

let db: DatabaseHandle;

beforeEach(() => resetKeyCache());

afterEach(() => {
  db?.close();
  resetKeyCache();
});

describe('migrateVaultToRandomKey — provider_keys (single group)', () => {
  it('re-encrypts a legacy-keyed row under the active key', () => {
    db = makeTestDb();
    const dir = tmpDir();
    const legacy = deriveLegacyKey();
    const legacyBlob = encrypt('sk-legacy', legacy);
    db.prepare('INSERT INTO provider_keys (transport, ciphertext, iv, auth_tag, updated_at) VALUES (?,?,?,?,?)')
      .run('anthropic', legacyBlob.ciphertext, legacyBlob.iv, legacyBlob.authTag, Date.now());

    migrateVaultToRandomKey(db, dir);

    const active = loadOrCreateVaultKey(dir);
    const row = db.prepare('SELECT ciphertext, iv, auth_tag FROM provider_keys WHERE transport = ?').get('anthropic') as any;
    expect(decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, active)).toBe('sk-legacy');
  });

  it('is idempotent for a row already under the active key', () => {
    db = makeTestDb();
    const dir = tmpDir();
    const active = loadOrCreateVaultKey(dir);
    const blob = encrypt('sk-new', active);
    db.prepare('INSERT INTO provider_keys (transport, ciphertext, iv, auth_tag, updated_at) VALUES (?,?,?,?,?)')
      .run('openai', blob.ciphertext, blob.iv, blob.authTag, Date.now());

    expect(() => migrateVaultToRandomKey(db, dir)).not.toThrow();

    const row = db.prepare('SELECT ciphertext, iv, auth_tag FROM provider_keys WHERE transport = ?').get('openai') as any;
    expect(decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, active)).toBe('sk-new');
    // Unchanged ciphertext proves the row wasn't touched a second time.
    expect(Buffer.from(row.ciphertext).equals(blob.ciphertext)).toBe(true);
  });

  it('leaves a row encrypted under neither key untouched (no throw, no data loss)', () => {
    db = makeTestDb();
    const dir = tmpDir();
    const unrelatedKey = Buffer.alloc(32, 7);
    const blob = encrypt('sk-mystery', unrelatedKey);
    db.prepare('INSERT INTO provider_keys (transport, ciphertext, iv, auth_tag, updated_at) VALUES (?,?,?,?,?)')
      .run('gemini', blob.ciphertext, blob.iv, blob.authTag, Date.now());

    expect(() => migrateVaultToRandomKey(db, dir)).not.toThrow();

    const row = db.prepare('SELECT ciphertext, iv, auth_tag FROM provider_keys WHERE transport = ?').get('gemini') as any;
    expect(Buffer.from(row.ciphertext).equals(blob.ciphertext)).toBe(true);
    const active = loadOrCreateVaultKey(dir);
    expect(() => decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, active)).toThrow();
  });
});

describe('migrateVaultToRandomKey — ollama_endpoints (two independent nullable groups)', () => {
  it('migrates token and headers groups independently when both are legacy-keyed', () => {
    db = makeTestDb();
    const dir = tmpDir();
    const legacy = deriveLegacyKey();
    const tokenBlob = encrypt('tok-legacy', legacy);
    const headersBlob = encrypt(JSON.stringify({ Authorization: 'Bearer legacy' }), legacy);
    db.prepare(
      `INSERT INTO ollama_endpoints
         (id, label, base_url, token_ciphertext, token_iv, token_auth_tag,
          headers_ciphertext, headers_iv, headers_auth_tag, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      'ep-1',
      'lab',
      'http://gpu.lan:11434',
      tokenBlob.ciphertext,
      tokenBlob.iv,
      tokenBlob.authTag,
      headersBlob.ciphertext,
      headersBlob.iv,
      headersBlob.authTag,
      Date.now(),
      Date.now(),
    );

    migrateVaultToRandomKey(db, dir);

    const active = loadOrCreateVaultKey(dir);
    const row = db.prepare('SELECT * FROM ollama_endpoints WHERE id = ?').get('ep-1') as any;
    expect(decrypt({ ciphertext: row.token_ciphertext, iv: row.token_iv, authTag: row.token_auth_tag }, active)).toBe(
      'tok-legacy',
    );
    expect(
      decrypt({ ciphertext: row.headers_ciphertext, iv: row.headers_iv, authTag: row.headers_auth_tag }, active),
    ).toBe(JSON.stringify({ Authorization: 'Bearer legacy' }));
  });

  it('migrates only the non-null group when token is null and headers is legacy-keyed', () => {
    db = makeTestDb();
    const dir = tmpDir();
    const legacy = deriveLegacyKey();
    const headersBlob = encrypt(JSON.stringify({ 'X-Foo': 'bar' }), legacy);
    db.prepare(
      `INSERT INTO ollama_endpoints
         (id, label, base_url, token_ciphertext, token_iv, token_auth_tag,
          headers_ciphertext, headers_iv, headers_auth_tag, created_at, updated_at)
       VALUES (?,?,?,NULL,NULL,NULL,?,?,?,?,?)`,
    ).run('ep-2', 'no-token', 'http://a', headersBlob.ciphertext, headersBlob.iv, headersBlob.authTag, Date.now(), Date.now());

    expect(() => migrateVaultToRandomKey(db, dir)).not.toThrow();

    const active = loadOrCreateVaultKey(dir);
    const row = db.prepare('SELECT * FROM ollama_endpoints WHERE id = ?').get('ep-2') as any;
    expect(row.token_ciphertext).toBeNull();
    expect(
      decrypt({ ciphertext: row.headers_ciphertext, iv: row.headers_iv, authTag: row.headers_auth_tag }, active),
    ).toBe(JSON.stringify({ 'X-Foo': 'bar' }));
  });

  it('is a no-op when both groups are null', () => {
    db = makeTestDb();
    const dir = tmpDir();
    db.prepare(
      `INSERT INTO ollama_endpoints
         (id, label, base_url, token_ciphertext, token_iv, token_auth_tag,
          headers_ciphertext, headers_iv, headers_auth_tag, created_at, updated_at)
       VALUES (?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,?,?)`,
    ).run('ep-3', 'bare', 'http://a', Date.now(), Date.now());

    expect(() => migrateVaultToRandomKey(db, dir)).not.toThrow();
    const row = db.prepare('SELECT * FROM ollama_endpoints WHERE id = ?').get('ep-3') as any;
    expect(row.token_ciphertext).toBeNull();
    expect(row.headers_ciphertext).toBeNull();
  });
});

describe('migrateVaultToRandomKey — openai_compat_endpoints (single nullable headers group)', () => {
  it('re-encrypts legacy-keyed headers', () => {
    db = makeTestDb();
    const dir = tmpDir();
    const legacy = deriveLegacyKey();
    const headersBlob = encrypt(JSON.stringify({ Authorization: 'Bearer legacy' }), legacy);
    db.prepare(
      `INSERT INTO openai_compat_endpoints
         (id, label, base_url, model, headers_ciphertext, headers_iv, headers_auth_tag, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run('oc-1', 'vllm', 'http://x/v1', null, headersBlob.ciphertext, headersBlob.iv, headersBlob.authTag, Date.now(), Date.now());

    migrateVaultToRandomKey(db, dir);

    const active = loadOrCreateVaultKey(dir);
    const row = db.prepare('SELECT * FROM openai_compat_endpoints WHERE id = ?').get('oc-1') as any;
    expect(
      decrypt({ ciphertext: row.headers_ciphertext, iv: row.headers_iv, authTag: row.headers_auth_tag }, active),
    ).toBe(JSON.stringify({ Authorization: 'Bearer legacy' }));
  });

  it('is a no-op when headers is null', () => {
    db = makeTestDb();
    const dir = tmpDir();
    db.prepare(
      `INSERT INTO openai_compat_endpoints
         (id, label, base_url, model, headers_ciphertext, headers_iv, headers_auth_tag, created_at, updated_at)
       VALUES (?,?,?,?,NULL,NULL,NULL,?,?)`,
    ).run('oc-2', 'plain', 'http://y/v1', 'llama3', Date.now(), Date.now());

    expect(() => migrateVaultToRandomKey(db, dir)).not.toThrow();
    const row = db.prepare('SELECT * FROM openai_compat_endpoints WHERE id = ?').get('oc-2') as any;
    expect(row.headers_ciphertext).toBeNull();
  });
});

describe('migrateVaultToRandomKey — cross-cutting', () => {
  it('is idempotent across two consecutive full runs', () => {
    db = makeTestDb();
    const dir = tmpDir();
    const legacy = deriveLegacyKey();
    const blob = encrypt('sk-legacy', legacy);
    db.prepare('INSERT INTO provider_keys (transport, ciphertext, iv, auth_tag, updated_at) VALUES (?,?,?,?,?)')
      .run('anthropic', blob.ciphertext, blob.iv, blob.authTag, Date.now());

    migrateVaultToRandomKey(db, dir);
    expect(() => migrateVaultToRandomKey(db, dir)).not.toThrow();

    const active = loadOrCreateVaultKey(dir);
    const row = db.prepare('SELECT ciphertext, iv, auth_tag FROM provider_keys WHERE transport = ?').get('anthropic') as any;
    expect(decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, active)).toBe('sk-legacy');
  });

  it('does nothing (and does not throw) against a freshly-migrated empty DB', () => {
    db = makeTestDb();
    const dir = tmpDir();
    expect(() => migrateVaultToRandomKey(db, dir)).not.toThrow();
  });
});
