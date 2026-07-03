import type { DatabaseHandle } from '@/server/db/database';
import { loadOrCreateVaultKey, deriveLegacyKey, encrypt, decrypt, type EncryptedBlob } from '@/server/lib/key-crypto';

/** True when a table with this name exists (migrations may predate it). */
function tableExists(db: DatabaseHandle, table: string): boolean {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}

type GroupOutcome =
  | { kind: 'skip' } // null blob, or already under the active key
  | { kind: 'reencrypted'; blob: EncryptedBlob }
  | { kind: 'undecryptable' }; // decrypts under neither key — left in place

/**
 * Classify one `(ciphertext, iv, authTag)` group against the active key:
 * `skip` (nothing to do), `reencrypted` (was legacy-keyed → new blob to persist),
 * or `undecryptable` (neither key works — the row is left untouched rather than
 * losing data, but the caller should surface it; see `warnUndecryptable`).
 */
function migrateGroup(blob: EncryptedBlob | null, active: Buffer, legacy: Buffer): GroupOutcome {
  if (!blob) return { kind: 'skip' };
  try {
    decrypt(blob, active);
    return { kind: 'skip' }; // already under the active key
  } catch {
    // fall through to legacy attempt
  }
  let plaintext: string;
  try {
    plaintext = decrypt(blob, legacy);
  } catch {
    return { kind: 'undecryptable' }; // unknown key: leave as-is rather than destroy data
  }
  return { kind: 'reencrypted', blob: encrypt(plaintext, active) };
}

/**
 * Log (once per group) that a stored secret is unreadable, naming the table, row
 * id, and column group — NEVER the ciphertext or plaintext. Without this the key
 * silently stops working with no operator-visible signal (issue #109).
 */
function warnUndecryptable(table: string, id: string, group: string): void {
  console.warn(
    `[vault-migrate] ${table} '${id}' (${group}) decrypts under neither the active nor the ` +
      `legacy vault key — left in place; this secret is unreadable and must be re-entered.`,
  );
}

interface ProviderKeyRow {
  transport: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
}

function migrateProviderKeys(db: DatabaseHandle, active: Buffer, legacy: Buffer): number {
  if (!tableExists(db, 'provider_keys')) return 0;
  const rows = db.prepare(`SELECT transport, ciphertext, iv, auth_tag FROM provider_keys`).all() as ProviderKeyRow[];
  const update = db.prepare(`UPDATE provider_keys SET ciphertext=?, iv=?, auth_tag=? WHERE transport=?`);
  let undecryptable = 0;
  for (const r of rows) {
    const blob = { ciphertext: r.ciphertext, iv: r.iv, authTag: r.auth_tag };
    const res = migrateGroup(blob, active, legacy);
    if (res.kind === 'reencrypted') update.run(res.blob.ciphertext, res.blob.iv, res.blob.authTag, r.transport);
    else if (res.kind === 'undecryptable') {
      warnUndecryptable('provider_keys', r.transport, 'key');
      undecryptable++;
    }
  }
  return undecryptable;
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

function migrateOllamaEndpoints(db: DatabaseHandle, active: Buffer, legacy: Buffer): number {
  if (!tableExists(db, 'ollama_endpoints')) return 0;
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

  let undecryptable = 0;
  for (const r of rows) {
    const tokenBlob =
      r.token_ciphertext && r.token_iv && r.token_auth_tag
        ? { ciphertext: r.token_ciphertext, iv: r.token_iv, authTag: r.token_auth_tag }
        : null;
    const resToken = migrateGroup(tokenBlob, active, legacy);
    if (resToken.kind === 'reencrypted') updateToken.run(resToken.blob.ciphertext, resToken.blob.iv, resToken.blob.authTag, r.id);
    else if (resToken.kind === 'undecryptable') {
      warnUndecryptable('ollama_endpoints', r.id, 'token');
      undecryptable++;
    }

    const headersBlob =
      r.headers_ciphertext && r.headers_iv && r.headers_auth_tag
        ? { ciphertext: r.headers_ciphertext, iv: r.headers_iv, authTag: r.headers_auth_tag }
        : null;
    const resHeaders = migrateGroup(headersBlob, active, legacy);
    if (resHeaders.kind === 'reencrypted') updateHeaders.run(resHeaders.blob.ciphertext, resHeaders.blob.iv, resHeaders.blob.authTag, r.id);
    else if (resHeaders.kind === 'undecryptable') {
      warnUndecryptable('ollama_endpoints', r.id, 'headers');
      undecryptable++;
    }
  }
  return undecryptable;
}

interface OpenAICompatEndpointRow {
  id: string;
  headers_ciphertext: Buffer | null;
  headers_iv: Buffer | null;
  headers_auth_tag: Buffer | null;
}

function migrateOpenAICompatEndpoints(db: DatabaseHandle, active: Buffer, legacy: Buffer): number {
  if (!tableExists(db, 'openai_compat_endpoints')) return 0;
  const rows = db
    .prepare(`SELECT id, headers_ciphertext, headers_iv, headers_auth_tag FROM openai_compat_endpoints`)
    .all() as OpenAICompatEndpointRow[];
  const updateHeaders = db.prepare(
    `UPDATE openai_compat_endpoints SET headers_ciphertext=?, headers_iv=?, headers_auth_tag=? WHERE id=?`,
  );

  let undecryptable = 0;
  for (const r of rows) {
    const headersBlob =
      r.headers_ciphertext && r.headers_iv && r.headers_auth_tag
        ? { ciphertext: r.headers_ciphertext, iv: r.headers_iv, authTag: r.headers_auth_tag }
        : null;
    const res = migrateGroup(headersBlob, active, legacy);
    if (res.kind === 'reencrypted') updateHeaders.run(res.blob.ciphertext, res.blob.iv, res.blob.authTag, r.id);
    else if (res.kind === 'undecryptable') {
      warnUndecryptable('openai_compat_endpoints', r.id, 'headers');
      undecryptable++;
    }
  }
  return undecryptable;
}

/** Summary of a migration pass. `undecryptable` counts secret groups that
 *  decrypt under neither key and were left in place (each is also warned). */
export interface VaultMigrationSummary {
  undecryptable: number;
}

/**
 * One-time, idempotent re-encryption of every vault secret under the active
 * (random, per-install) key. For each encrypted column group independently:
 * skip if the group is null; else decrypt-with-active (already migrated,
 * skip); else decrypt-with-legacy → re-encrypt-with-active; else (unknown
 * key) leave untouched AND warn (issue #109). Runs in one transaction so a
 * mid-migration failure can't leave the vault partially re-keyed.
 */
export function migrateVaultToRandomKey(db: DatabaseHandle, dataDir: string): VaultMigrationSummary {
  const active = loadOrCreateVaultKey(dataDir);
  const legacy = deriveLegacyKey();
  let undecryptable = 0;
  const run = db.transaction(() => {
    undecryptable += migrateProviderKeys(db, active, legacy);
    undecryptable += migrateOllamaEndpoints(db, active, legacy);
    undecryptable += migrateOpenAICompatEndpoints(db, active, legacy);
  });
  run();
  return { undecryptable };
}
