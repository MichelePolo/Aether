# Aether Slice 18 — In-app provider key vault (design spec)

**Date:** 2026-05-23
**Branch:** `feat/slice-18-key-vault`
**Roadmap entry:** docs/superpowers/roadmap.md → "Slice 18 — In-app provider key vault"

## Goal

Let users enter, update, and clear provider API keys (Gemini, OpenAI, Anthropic) from inside the running app — without restarting the server — and see the live result of the change reflected in the registry and the provider auth pane within seconds.

## Scope decisions

| Decision | Choice |
|---|---|
| Storage at rest | AES-256-GCM with a 32-byte key derived via `scrypt` from `${os.hostname()}\|${os.userInfo().username}` + a static salt. |
| Reveal | Masked by default; an eye toggle re-fetches plaintext, displays it for 10 s, then re-masks. |
| Entry points | Palette command `Configure API keys…` AND clicking a non-OK row in `ProviderAuthSection`. |
| Modal scope | All 4 transports visible: 3 vault-editable (anthropic / openai / gemini) + 2 read-only info rows (anthropic-oauth, ollama). |
| Save behavior | Auto re-runs `providers.refresh()` + `authStatusService.probe([transport])`; modal stays open with live status dot. |
| Clear UX | Inline two-click confirm; button label flips to "Confirm clear?" then reverts after ~4 s. |
| Env-var precedence | Env var always wins; vault is consulted only when no env var is set. |
| Persistence | New SQLite table `provider_keys` (migration 003). |

## Crypto

`server/lib/key-crypto.ts`:

```ts
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import os from 'node:os';

const SALT = Buffer.from('aether-key-vault-salt-v1', 'utf-8');
const KEY_LEN = 32;         // AES-256
const IV_LEN = 12;          // AES-GCM standard
const SCRYPT_N = 16384;     // memory cost
const SCRYPT_r = 8;
const SCRYPT_p = 1;

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function deriveKey(): Buffer {
  const seed = `${os.hostname()}|${os.userInfo().username}`;
  return scryptSync(seed, SALT, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
}

export function encrypt(plaintext: string): EncryptedBlob { /* ... */ }
export function decrypt(blob: EncryptedBlob): string { /* throws on auth-tag mismatch */ }
```

The key is **derived on every call**. It's cheap-ish (scrypt with these parameters is ~50 ms one-time, can be memoized in process). Tampering with ciphertext or auth tag causes `decrypt` to throw.

## Data shapes

```ts
// server/domain/providers/key-vault.types.ts
export type VaultTransport = 'anthropic' | 'openai' | 'gemini';
export type InfoTransport = 'anthropic-oauth' | 'ollama';

export interface MaskedKeyRow {
  transport: VaultTransport;
  hasKey: boolean;
  masked: string | null;     // null when hasKey=false
  updatedAt: number | null;
}

export interface ReadonlyInfoRow {
  transport: InfoTransport;
  label: string;
  status: string;
}

export interface KeyVaultListResponse {
  vault: MaskedKeyRow[];     // always 3 entries in fixed order
  info: ReadonlyInfoRow[];   // always 2 entries
}
```

`mask(key)`:
- empty → `null`
- `length <= 8` → `'***'`
- otherwise → `${key.slice(0, 3)}…${key.slice(-4)}` (e.g. `sk_…aB3x`)

## Architecture

### Server

- **`003_provider_keys.sql`**:
  ```sql
  CREATE TABLE provider_keys (
    transport TEXT PRIMARY KEY CHECK (transport IN ('anthropic','openai','gemini')),
    ciphertext BLOB NOT NULL,
    iv BLOB NOT NULL,
    auth_tag BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
  ```

- **`server/lib/key-crypto.ts`** — `deriveKey`, `encrypt`, `decrypt`. Pure function over OS + `crypto`.

- **`server/domain/providers/key-vault.ts`** — `class KeyVaultService`:
  ```ts
  constructor(db: DatabaseHandle);
  setKey(transport: VaultTransport, plaintext: string): void;
  getKey(transport: VaultTransport): string | null;   // returns null on missing or decrypt failure
  clearKey(transport: VaultTransport): void;
  listMasked(): MaskedKeyRow[];
  buildInfoRows(opts: { anthropicCliPresent: boolean; ollamaHost: string }): ReadonlyInfoRow[];
  ```
  Decrypt failures are caught and logged; the row is treated as cleared.

- **`server/routes/providers.routes.ts`** — extend with:
  - `GET /keys` → 200 `{ vault, info }`. 503 if `keyVault` absent.
  - `GET /keys/:transport?reveal=1` → 200 `{ plaintext: string }`. 404 if no key. 400 if `reveal` ≠ '1'.
  - `PUT /keys/:transport` body `{ key: string }` → set, re-probe, return 200 `{ row: MaskedKeyRow, status: TransportStatus }`. 400 on validation; 503 if absent.
  - `DELETE /keys/:transport` → clear, re-probe, return 200 `{ status: TransportStatus }`. 503 if absent.

- **`server/app.ts`** — `AppDeps.keyVault?: KeyVaultService`; pass into providers routes factory.

- **`server/index.ts`** — bootstrap:
  ```ts
  const keyVault = new KeyVaultService(db);
  const resolved = resolveProviderKeys(cfg, keyVault);
  if (resolved.anthropicApiKey) {
    process.env.ANTHROPIC_API_KEY = resolved.anthropicApiKey;
  }
  // existing detectAnthropicAuth(), ProviderRegistry, AuthStatusService construction
  // now using resolved.openAIApiKey / resolved.geminiApiKey instead of cfg directly.
  ```
  `resolveProviderKeys(cfg, vault)` prefers env over vault.

### Frontend

- **`src/types/key-vault.types.ts`** — mirror of server types.

- **`src/lib/api/providers.api.ts`** — extend with `listKeys()`, `setKey(t, key)`, `clearKey(t)`, `revealKey(t)`.

- **`src/stores/keyVault.store.ts`** — Zustand:
  - State: `vault: MaskedKeyRow[]`, `info: ReadonlyInfoRow[]`, `loading: boolean`, `error: string | null`.
  - Actions: `init()`, `save(t, key)`, `clear(t)`, `reveal(t): Promise<string>` (returns plaintext; not stored in state).
  - After successful save/clear, fires `useProvidersStore.init()` + `useProviderAuthStore.refresh(t)` for cross-store consistency.
  - Per-transport dedupe map mirrors the auth-status store pattern.

- **`src/components/profiles/KeyVaultModal.tsx`** — modal at App level. 5 rows in fixed order:
  1. **anthropic** (vault row) — input + Save / Replace / Clear / 👁 reveal toggle.
  2. **anthropic-oauth** (info row) — read-only line with `status` text.
  3. **openai** (vault row).
  4. **gemini** (vault row).
  5. **ollama** (info row).
  Each vault row also shows the live `TransportStatus` dot for that transport (subscribed to `useProviderAuthStore`). Banner at the top renders `keyVaultStore.error` when present. Reveal auto-hides after 10 s. Closing the modal clears any revealed state.

- **`src/stores/ui.store.ts`** — add `keyVaultOpen`, `keyVaultFocusTransport`, `openKeyVault(t?)`, `closeKeyVault()`. Reset on `closeKeyVault`.

- **`src/hooks/useCommands.ts`** — palette command `keys.configure` → `openKeyVault()`.

- **`src/components/sidebar/ProviderAuthSection.tsx`** — non-OK rows become buttons that call `openKeyVault(transport)`. OK rows render as plain divs.

- **`src/App.tsx`** — mount `<KeyVaultModal />` near `<ProfilesModal />`; on mount, `useKeyVaultStore.init()` runs alongside the other inits.

### MSW

- **`src/test/msw-handlers.ts`** — defaults for:
  - `GET /api/providers/keys` → 3 vault rows (`hasKey:false`) + 2 info rows.
  - `PUT /api/providers/keys/:t` → echo a masked row + a synthetic `ok` status.
  - `DELETE /api/providers/keys/:t` → 204 + synthetic `unconfigured` status.
  - `GET /api/providers/keys/:t?reveal=1` → `{ plaintext: 'sk-test-…' }`.

## Data flow

### Open from palette
1. Cmd+K → `Configure API keys…` → `openKeyVault()`.
2. `KeyVaultModal` mounts; `useKeyVaultStore.init()` runs → `GET /api/providers/keys`.
3. 5 rows render with current state + auth-status dots.

### Open from sidebar
1. Click any non-OK row in `ProviderAuthSection`.
2. `openKeyVault(transport)` → modal opens, that transport's input is auto-focused.

### Save
1. User types key → clicks `Save`.
2. `keyVaultStore.save(t, key)` → `PUT /api/providers/keys/:t { key }`.
3. Server: `KeyVaultService.setKey` encrypts via `key-crypto.encrypt` (fresh random IV) and UPSERTs. Then `resolveProviderKeys()` recomputes, `providers.refresh()` runs, `authStatusService.probe([t])` runs.
4. Server returns `{ row: MaskedKeyRow, status: TransportStatus }`.
5. FE: replace row, clear error, fire `useProvidersStore.init()` + `useProviderAuthStore.refresh(t)`. Status dot inside the modal updates within ~1 s.

### Clear (two-click confirm)
1. First click on `Clear` → label becomes "Confirm clear?" for ~4 s.
2. Second click → `DELETE /api/providers/keys/:t`. Server clears, re-probes. Row reverts; dot updates.
3. Otherwise reverts after timeout.

### Reveal
1. 👁 button → `GET /api/providers/keys/:t?reveal=1` → plaintext returned in JSON body.
2. FE temporarily replaces the masked display for 10 s, then re-masks. Plaintext is held only in local component state, never in store.
3. Closing the modal forces the re-mask immediately.

## Error handling

| Scenario | Server | FE surface |
|---|---|---|
| Empty key in PUT | 400 VALIDATION_ERROR "Key required" | Inline error under the input. |
| Unknown transport in URL | 400 VALIDATION_ERROR | Top banner. |
| `decrypt()` throws (wrong machine / corrupted row) | Logged warning; `getKey` returns null; `listMasked` reports `hasKey:false`. | Row appears as "not set"; user can re-enter. |
| Bootstrap can't derive key (unusual platform) | `keyVault` undefined in `AppDeps`. All 4 routes 503 `NO_KEY_VAULT`. | Modal renders an "unavailable on this host" banner. |
| Reveal of unset key | 404 NOT_FOUND. | Button is disabled when `hasKey:false`. |
| Network failure | — | `keyVaultStore.error = <message>`. |

## Logging

The vault NEVER logs plaintext. Decrypt failures log only the transport identifier and `"auth-tag mismatch"`. Masked forms (`sk_…xyz`) are safe to log.

## Testing strategy

### Server (vitest)
- `key-crypto.test.ts`: roundtrip, IV uniqueness, tamper detection (ciphertext + authTag), deterministic key derivation.
- `key-vault.test.ts`: round-trip set/get/clear, overwrite, listMasked masking rules, corrupted-ciphertext graceful handling, persistence across construction, info rows.
- `providers.routes.test.ts`: append 7 cases — list, set, set-invalid-key, set-invalid-transport, clear, reveal-existing, reveal-missing, all-4-503-when-absent.

### Frontend (vitest + RTL + MSW)
- `providers.api.test.ts`: 4 new cases (list/set/clear/reveal URL+verb).
- `keyVault.store.test.ts`: init, save (with cross-store side effects via spies), clear, dedupe, error.
- `KeyVaultModal.test.tsx`: row order, save flow, reveal toggle, two-click clear, status-dot binding, banner, close clears reveal.
- `ProviderAuthSection.test.tsx`: append — non-OK rows call `openKeyVault(t)`; OK rows don't.
- `useCommands.test.ts`: append — `keys.configure` command present + opens vault.

### Integration (vitest + RTL + MSW)
- `src/integration/key-vault.integration.test.tsx`: palette → open → save key → assert PUT body + status-dot turns green → two-click clear → status reverts.

### Playwright (e2e/smoke.spec.ts)
- Open palette → `Configure API keys…` → 5 rows visible → type a key → Save → reopen → masked key visible → two-click clear → row reverts.

## Out of scope

- Anthropic OAuth setup flow (still managed via the `claude` CLI).
- Custom Ollama host configuration (still env / default).
- Key rotation policies / expiry.
- Key sharing across machines.
- Audit log of who saved what / when (beyond `updated_at`).

## Acceptance criteria

1. Palette command `Configure API keys…` opens a modal with 5 rows in fixed order (anthropic, anthropic-oauth, openai, gemini, ollama).
2. Saving an OpenAI key persists encrypted to `provider_keys`, triggers `providers.refresh()` and `authStatusService.probe(['openai'])`, and the OpenAI dot in both the modal and the sidebar turns green within ~1 s.
3. Two-click `Clear` removes the key; the dot reverts to `unconfigured` (or `error`) within ~1 s.
4. 👁 reveal returns the plaintext, displays it for 10 s, then auto-masks. Closing the modal also masks.
5. Env-var keys still win — even when the vault has a value, `process.env.OPENAI_API_KEY` (if set) is used by the registry.
6. Decrypting a row produced on another machine (different hostname/username) silently fails and reports the row as `hasKey:false` without crashing the bootstrap.
7. Clicking a non-OK row in `ProviderAuthSection` opens the vault modal with that transport's input focused.
