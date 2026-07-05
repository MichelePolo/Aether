# Key vault

What this covers: how provider API keys and openai-compat/Ollama endpoint secrets are encrypted at rest. Read this when you're handling credentials, debugging a "provider disappeared after upgrade" report, or reviewing the vault's security properties.

## How it works

Every secret (provider API key, Ollama endpoint token/headers, openai-compat endpoint headers) is stored as an **AES-256-GCM** blob (`ciphertext`, `iv`, `authTag`) in SQLite — see `encrypt()` / `decrypt()` in `server/lib/key-crypto.ts` and the row shape in `KeyVaultService` (`server/domain/providers/key-vault.ts`).

**Key material**: the active vault key is resolved by `loadOrCreateVaultKey(dataDir)` (`server/lib/key-crypto.ts`):
1. If `AETHER_VAULT_KEY` is set, it must be 64 hex characters (32 bytes) or the process throws at startup.
2. Otherwise, a random 32-byte key is generated once and persisted at `${AETHER_DATA_DIR}/.vault.key` with file mode `0600`. Living inside the data dir means the key travels along with a synced/copied database, avoiding the "keys work on one machine only" failure mode.
3. The key is cached in-process after first load (`cachedKey`).

**Resolution order for reads**: `KeyResolver.get()` (`server/domain/providers/key-resolver.ts`) checks the matching env var (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`) first, and only queries `KeyVaultService.getKey()` (decrypt-and-return) if the env var is unset. This means an env var always wins over a stored vault key, for any of the three vault-backed transports.

**Plaintext exposure**: the HTTP API never returns decrypted key material. `KeyVaultService.listMasked()` returns `mask(plaintext)` (a redacted display string) plus `hasKey` and `updatedAt` — the actual plaintext stays server-side. Similarly, `OpenAICompatEndpointRecord` (`server/domain/providers/openai-endpoints.types.ts`) exposes only header **keys**, never header values.

**Migration / key-mismatch behavior**: `migrateVaultToRandomKey()` (`server/lib/vault-migrate.ts`) runs once at boot inside a transaction. For every encrypted column group across `provider_keys`, `ollama_endpoints`, and `openai_compat_endpoints`, it tries the active key first (already migrated → skip), then a legacy hostname-derived key (`deriveLegacyKey()`, kept only for this one-time migration) — if that decrypts, it re-encrypts the value under the active key. If a blob decrypts under **neither** key, the row is left untouched (never destroyed) and `warnUndecryptable()` logs a warning naming the table and row id — but never the ciphertext or plaintext — so the operator gets a visible signal that a secret is unreadable and must be re-entered, instead of the key silently failing.

Note: `KeyVaultService.getKey()` also independently catches a decrypt failure (auth-tag mismatch) at read time and logs a warning, returning `null` rather than throwing — so a single corrupted/foreign-keyed row degrades to "key not set" instead of crashing the caller.

## Key files

- `server/lib/key-crypto.ts` — `loadOrCreateVaultKey`, `deriveLegacyKey`, `encrypt`/`decrypt` (AES-256-GCM)
- `server/domain/providers/key-vault.ts` — `KeyVaultService`: set/get/clear/list-masked
- `server/domain/providers/key-resolver.ts` — env-first `KeyResolver`
- `server/lib/vault-migrate.ts` — one-time re-encryption pass and the undecryptable-row warning
- `server/index.ts` — where the vault key is loaded and migration is invoked at boot

## See also

- [Providers](providers.md) — how resolved keys gate which providers appear in the registry
- [Configuration](../reference/configuration.md) — `AETHER_VAULT_KEY` and `AETHER_DATA_DIR`
- [Database](../reference/database.md) — the `provider_keys`, `ollama_endpoints`, `openai_compat_endpoints` tables
