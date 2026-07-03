import type { DatabaseHandle } from '@/server/db/database';
import { loadOrCreateVaultKey, deriveLegacyKey, encrypt, decrypt, type EncryptedBlob } from '@/server/lib/key-crypto';

/** True when a table with this name exists (migrations may predate it). */
function tableExists(db: DatabaseHandle, table: string): boolean {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}

/**
 * Re-encrypt one `(ciphertext, iv, authTag)` group under the active key, if
 * it isn't already. Returns the re-encrypted blob to persist, or null when
 * no UPDATE is needed (already active-keyed, blob is null, or the blob
 * decrypts under neither key — left untouched rather than losing data).
 */
function migrateGroup(blob: EncryptedBlob | null, active: Buffer, legacy: Buffer): EncryptedBlob | null {
  if (!blob) return null;
  try {
    decrypt(blob, active);
    return null; // already under the active key
  } catch {
    // fall through to legacy attempt
  }
  let plaintext: string;
  try {
    plaintext = decrypt(blob, legacy);
  } catch {
    return null; // unknown key: leave as-is rather than destroy data
  }
  return encrypt(plaintext, active);
}

interface ProviderKeyRow {
  transport: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
}

function migrateProviderKeys(db: DatabaseHandle, active: Buffer, legacy: Buffer): void {
  if (!tableExists(db, 'provider_keys')) return;
  const rows = db.prepare(`SELECT transport, ciphertext, iv, auth_tag FROM provider_keys`).all() as ProviderKeyRow[];
  const update = db.prepare(`UPDATE provider_keys SET ciphertext=?, iv=?, auth_tag=? WHERE transport=?`);
  for (const r of rows) {
    const blob = { ciphertext: r.ciphertext, iv: r.iv, authTag: r.auth_tag };
    const re = migrateGroup(blob, active, legacy);
    if (re) update.run(re.ciphertext, re.iv, re.authTag, r.transport);
  }
}

interface OllamaEndpointRow {
  id: string;
  token_ciphertext: Buffer | null;
  token_iv: Buffer | null;
  token_auth_tag: Buffer | null;
  headers_ciphertext: Buffer | null;
  headers_iv: Buffer | null;
  headers_auth_tag: Buffer | null;
}

function migrateOllamaEndpoints(db: DatabaseHandle, active: Buffer, legacy: Buffer): void {
  if (!tableExists(db, 'ollama_endpoints')) return;
  const rows = db
    .prepare(
      `SELECT id, token_ciphertext, token_iv, token_auth_tag,
              headers_ciphertext, headers_iv, headers_auth_tag
         FROM ollama_endpoints`,
    )
    .all() as OllamaEndpointRow[];

  const updateToken = db.prepare(`UPDATE ollama_endpoints SET token_ciphertext=?, token_iv=?, token_auth_tag=? WHERE id=?`);
  const updateHeaders = db.prepare(
    `UPDATE ollama_endpoints SET headers_ciphertext=?, headers_iv=?, headers_auth_tag=? WHERE id=?`,
  );

  for (const r of rows) {
    const tokenBlob =
      r.token_ciphertext && r.token_iv && r.token_auth_tag
        ? { ciphertext: r.token_ciphertext, iv: r.token_iv, authTag: r.token_auth_tag }
        : null;
    const reToken = migrateGroup(tokenBlob, active, legacy);
    if (reToken) updateToken.run(reToken.ciphertext, reToken.iv, reToken.authTag, r.id);

    const headersBlob =
      r.headers_ciphertext && r.headers_iv && r.headers_auth_tag
        ? { ciphertext: r.headers_ciphertext, iv: r.headers_iv, authTag: r.headers_auth_tag }
        : null;
    const reHeaders = migrateGroup(headersBlob, active, legacy);
    if (reHeaders) updateHeaders.run(reHeaders.ciphertext, reHeaders.iv, reHeaders.authTag, r.id);
  }
}

interface OpenAICompatEndpointRow {
  id: string;
  headers_ciphertext: Buffer | null;
  headers_iv: Buffer | null;
  headers_auth_tag: Buffer | null;
}

function migrateOpenAICompatEndpoints(db: DatabaseHandle, active: Buffer, legacy: Buffer): void {
  if (!tableExists(db, 'openai_compat_endpoints')) return;
  const rows = db
    .prepare(`SELECT id, headers_ciphertext, headers_iv, headers_auth_tag FROM openai_compat_endpoints`)
    .all() as OpenAICompatEndpointRow[];
  const updateHeaders = db.prepare(
    `UPDATE openai_compat_endpoints SET headers_ciphertext=?, headers_iv=?, headers_auth_tag=? WHERE id=?`,
  );

  for (const r of rows) {
    const headersBlob =
      r.headers_ciphertext && r.headers_iv && r.headers_auth_tag
        ? { ciphertext: r.headers_ciphertext, iv: r.headers_iv, authTag: r.headers_auth_tag }
        : null;
    const reHeaders = migrateGroup(headersBlob, active, legacy);
    if (reHeaders) updateHeaders.run(reHeaders.ciphertext, reHeaders.iv, reHeaders.authTag, r.id);
  }
}

/**
 * One-time, idempotent re-encryption of every vault secret under the active
 * (random, per-install) key. For each encrypted column group independently:
 * skip if the group is null; else decrypt-with-active (already migrated,
 * skip); else decrypt-with-legacy → re-encrypt-with-active; else (unknown
 * key) leave untouched. Runs in one transaction so a mid-migration failure
 * can't leave the vault partially re-keyed.
 */
export function migrateVaultToRandomKey(db: DatabaseHandle, dataDir: string): void {
  const active = loadOrCreateVaultKey(dataDir);
  const legacy = deriveLegacyKey();
  const run = db.transaction(() => {
    migrateProviderKeys(db, active, legacy);
    migrateOllamaEndpoints(db, active, legacy);
    migrateOpenAICompatEndpoints(db, active, legacy);
  });
  run();
}
