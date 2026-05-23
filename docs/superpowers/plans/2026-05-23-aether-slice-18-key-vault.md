# Slice 18 — In-app provider key vault — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add / update / clear provider API keys at runtime through a modal, with the registry and auth pane reflecting the change within ~1 s — no server restart.

**Architecture:** A `KeyVaultService` encrypts plaintext keys (AES-256-GCM, machine-derived key via scrypt) and persists to a new `provider_keys` SQLite table. A new `KeyResolver` (env wins → vault) replaces the static API-key dependencies of `ProviderRegistry` and `AuthStatusService` so both consult the live resolver on every `refresh()` / `probe()`. Four new routes mounted under `/api/providers/keys` round-trip the keys; each mutation runs `providers.refresh()` + `authStatusService.probe([transport])` and (for Anthropic) updates `process.env.ANTHROPIC_API_KEY`. The frontend ships a `KeyVaultModal` opened from the palette and from non-OK rows in `ProviderAuthSection`.

**Tech Stack:** Node `crypto` (scrypt, AES-256-GCM), better-sqlite3, Express, Zustand, MSW, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-23-aether-slice-18-key-vault-design.md`

**Branch:** `feat/slice-18-key-vault`

---

## File Structure

**Server**
- Create: `server/db/migrations/003_provider_keys.sql` — schema.
- Create: `server/lib/key-crypto.ts` — `deriveKey`, `encrypt`, `decrypt`.
- Create: `server/lib/key-crypto.test.ts`.
- Create: `server/domain/providers/key-vault.types.ts` — `VaultTransport`, `MaskedKeyRow`, `KeyVaultListResponse`, etc.
- Create: `server/domain/providers/key-vault.ts` — `class KeyVaultService`.
- Create: `server/domain/providers/key-vault.test.ts`.
- Create: `server/domain/providers/key-resolver.ts` — `KeyResolver` class (env-wins-over-vault).
- Create: `server/domain/providers/key-resolver.test.ts`.
- Modify: `server/domain/providers/registry.ts` — accept `resolveKey` + `detectAnthropicAuth` as callbacks (was fixed values).
- Modify: `server/domain/providers/registry.test.ts` — adapt `baseDeps()`.
- Modify: `server/domain/providers/auth-status.ts` — accept `getOpenAIKey` / `getGeminiKey` callbacks.
- Modify: `server/domain/providers/auth-status.test.ts` — adapt fixtures.
- Modify: `server/routes/providers.routes.ts` — add 4 vault routes + accept `keyVault` + `providers.refresh()` callback.
- Modify: `server/routes/providers.routes.test.ts` — add 7 cases.
- Modify: `server/app.ts` — `AppDeps.keyVault?: KeyVaultService`.
- Modify: `server/index.ts` — construct vault + resolver, restructure provider/auth-status wiring.

**Frontend**
- Create: `src/types/key-vault.types.ts`.
- Modify: `src/lib/api/providers.api.ts` — add 4 vault methods.
- Modify: `src/lib/api/providers.api.test.ts` — add 4 cases.
- Create: `src/stores/keyVault.store.ts`.
- Create: `src/stores/keyVault.store.test.ts`.
- Modify: `src/stores/ui.store.ts` — `keyVaultOpen`, `keyVaultFocusTransport`, `openKeyVault`, `closeKeyVault`.
- Modify: `src/stores/ui.store.test.ts` — add cases.
- Modify: `src/hooks/useCommands.ts` — add `keys.configure` command.
- Modify: `src/hooks/useCommands.test.ts` — add case.
- Create: `src/components/profiles/KeyVaultModal.tsx`.
- Create: `src/components/profiles/KeyVaultModal.test.tsx`.
- Modify: `src/components/sidebar/ProviderAuthSection.tsx` — non-OK rows clickable.
- Modify: `src/components/sidebar/ProviderAuthSection.test.tsx` — add case.
- Modify: `src/App.tsx` — mount `<KeyVaultModal />`, init the vault store.
- Modify: `src/test/msw-handlers.ts` — defaults for new endpoints.

**Integration / e2e**
- Create: `src/integration/key-vault.integration.test.tsx`.
- Modify: `e2e/smoke.spec.ts` — add smoke.

---

## Task A1: Branch setup

**Files:** (verification only)

- [ ] **Step 1: Confirm branch + clean tree**

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: branch `feat/slice-18-key-vault`. If not:
```bash
git checkout -b feat/slice-18-key-vault
```

- [ ] **Step 2: Verify spec committed**

```bash
git log --oneline -5 -- docs/superpowers/specs/2026-05-23-aether-slice-18-key-vault-design.md
```

Expected: at least one commit on this branch.

---

## Task B1: Migration 003 + key-crypto module

**Files:**
- Create: `server/db/migrations/003_provider_keys.sql`
- Create: `server/lib/key-crypto.ts`
- Create: `server/lib/key-crypto.test.ts`

- [ ] **Step 1: Write the migration**

Create `server/db/migrations/003_provider_keys.sql`:

```sql
-- Encrypted provider API keys (AES-256-GCM, machine-derived key).
CREATE TABLE provider_keys (
  transport TEXT PRIMARY KEY CHECK (transport IN ('anthropic','openai','gemini')),
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Write failing tests** — `server/lib/key-crypto.test.ts`

```ts
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
```

- [ ] **Step 3: Run, expect FAIL (module missing)**

```bash
npx vitest run server/lib/key-crypto.test.ts
```

- [ ] **Step 4: Implement `server/lib/key-crypto.ts`**

```ts
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
```

- [ ] **Step 5: Run, expect GREEN**

```bash
npx vitest run server/lib/key-crypto.test.ts
```

Expected: 7 cases pass.

- [ ] **Step 6: Sanity-check migration loads in tests**

```bash
npx vitest run server/test/test-db.test.ts 2>/dev/null || true
npx vitest run server/db/migrate.test.ts
```

Expected: any existing migrate tests still pass — the new file 003 is automatically picked up.

- [ ] **Step 7: Commit**

```bash
git add server/db/migrations/003_provider_keys.sql server/lib/key-crypto.ts server/lib/key-crypto.test.ts
git commit -m "feat(slice-18): provider_keys migration + AES-256-GCM key-crypto module"
```

---

## Task C1: KeyVaultService

**Files:**
- Create: `server/domain/providers/key-vault.types.ts`
- Create: `server/domain/providers/key-vault.ts`
- Create: `server/domain/providers/key-vault.test.ts`

- [ ] **Step 1: Types** — `server/domain/providers/key-vault.types.ts`

```ts
export type VaultTransport = 'anthropic' | 'openai' | 'gemini';
export type InfoTransport = 'anthropic-oauth' | 'ollama';

export const VAULT_TRANSPORTS: readonly VaultTransport[] = ['anthropic', 'openai', 'gemini'];

export interface MaskedKeyRow {
  transport: VaultTransport;
  hasKey: boolean;
  masked: string | null;
  updatedAt: number | null;
}

export interface ReadonlyInfoRow {
  transport: InfoTransport;
  label: string;
  status: string;
}

export interface KeyVaultListResponse {
  vault: MaskedKeyRow[];
  info: ReadonlyInfoRow[];
}

export function mask(key: string): string | null {
  if (!key) return null;
  if (key.length <= 8) return '***';
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}
```

- [ ] **Step 2: Failing tests** — `server/domain/providers/key-vault.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import { KeyVaultService } from './key-vault';
import { encrypt } from '@/server/lib/key-crypto';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let vault: KeyVaultService;

beforeEach(() => {
  db = makeTestDb();
  vault = new KeyVaultService(db);
});
afterEach(() => db.close());

describe('KeyVaultService — set/get/clear', () => {
  it('round-trips an openai key', () => {
    vault.setKey('openai', 'sk-openai-test-key-12345');
    expect(vault.getKey('openai')).toBe('sk-openai-test-key-12345');
  });

  it('returns null for a missing key', () => {
    expect(vault.getKey('openai')).toBeNull();
  });

  it('clearKey removes the row', () => {
    vault.setKey('openai', 'sk-x');
    vault.clearKey('openai');
    expect(vault.getKey('openai')).toBeNull();
  });

  it('setKey overwrites an existing row', () => {
    vault.setKey('openai', 'sk-first');
    vault.setKey('openai', 'sk-second');
    expect(vault.getKey('openai')).toBe('sk-second');
  });

  it('persists across construction', () => {
    vault.setKey('gemini', 'gk-1');
    const vault2 = new KeyVaultService(db);
    expect(vault2.getKey('gemini')).toBe('gk-1');
  });
});

describe('KeyVaultService.listMasked', () => {
  it('returns 3 rows in fixed order with hasKey=false when empty', () => {
    const rows = vault.listMasked();
    expect(rows.map((r) => r.transport)).toEqual(['anthropic', 'openai', 'gemini']);
    expect(rows.every((r) => r.hasKey === false && r.masked === null)).toBe(true);
  });

  it('reports masked key after set', () => {
    vault.setKey('openai', 'sk-openai-test-key-12345');
    const rows = vault.listMasked();
    const oa = rows.find((r) => r.transport === 'openai')!;
    expect(oa.hasKey).toBe(true);
    expect(oa.masked).toBe('sk-…2345');
    expect(typeof oa.updatedAt).toBe('number');
  });

  it('uses "***" mask for short keys', () => {
    vault.setKey('openai', 'short');
    const oa = vault.listMasked().find((r) => r.transport === 'openai')!;
    expect(oa.masked).toBe('***');
  });
});

describe('KeyVaultService — corrupted ciphertext', () => {
  it('getKey returns null and listMasked reports hasKey=false when authTag tampered', () => {
    vault.setKey('openai', 'sk-x');
    db.prepare('UPDATE provider_keys SET auth_tag = ? WHERE transport = ?').run(
      Buffer.alloc(16, 0),
      'openai',
    );
    expect(vault.getKey('openai')).toBeNull();
    const row = vault.listMasked().find((r) => r.transport === 'openai')!;
    expect(row.hasKey).toBe(false);
    expect(row.masked).toBeNull();
  });
});

describe('KeyVaultService.buildInfoRows', () => {
  it('reports anthropic-oauth + ollama with the right labels', () => {
    const info = vault.buildInfoRows({
      anthropicCliPresent: true,
      ollamaHost: 'http://localhost:11434',
    });
    expect(info.map((r) => r.transport)).toEqual(['anthropic-oauth', 'ollama']);
    const a = info[0];
    expect(a.label).toMatch(/Anthropic OAuth/i);
    expect(a.status).toMatch(/detected/i);
    expect(info[1].status).toContain('11434');
  });

  it('reports anthropic-oauth as "no CLI" when absent', () => {
    const info = vault.buildInfoRows({
      anthropicCliPresent: false,
      ollamaHost: 'http://x',
    });
    expect(info[0].status).toMatch(/no CLI/i);
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run server/domain/providers/key-vault.test.ts
```

- [ ] **Step 4: Implement `server/domain/providers/key-vault.ts`**

```ts
import type { DatabaseHandle } from '@/server/db/database';
import { encrypt, decrypt, type EncryptedBlob } from '@/server/lib/key-crypto';
import {
  VAULT_TRANSPORTS,
  type VaultTransport,
  type MaskedKeyRow,
  type ReadonlyInfoRow,
  mask,
} from './key-vault.types';

interface ProviderKeyRow {
  transport: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  updated_at: number;
}

export class KeyVaultService {
  constructor(private readonly db: DatabaseHandle) {}

  setKey(transport: VaultTransport, plaintext: string): void {
    if (!plaintext) throw new Error('Key required');
    const blob = encrypt(plaintext);
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO provider_keys (transport, ciphertext, iv, auth_tag, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(transport) DO UPDATE SET ' +
          'ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag, updated_at = excluded.updated_at',
      )
      .run(transport, blob.ciphertext, blob.iv, blob.auth_tag ?? blob.authTag, now);
  }

  getKey(transport: VaultTransport): string | null {
    const row = this.db
      .prepare(
        'SELECT transport, ciphertext, iv, auth_tag, updated_at FROM provider_keys WHERE transport = ?',
      )
      .get(transport) as ProviderKeyRow | undefined;
    if (!row) return null;
    try {
      const blob: EncryptedBlob = { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag };
      return decrypt(blob);
    } catch (err) {
      console.warn(`[key-vault] decrypt failed for ${transport}: auth-tag mismatch`);
      return null;
    }
  }

  clearKey(transport: VaultTransport): void {
    this.db.prepare('DELETE FROM provider_keys WHERE transport = ?').run(transport);
  }

  listMasked(): MaskedKeyRow[] {
    return VAULT_TRANSPORTS.map((transport) => {
      const plaintext = this.getKey(transport);
      const row = this.db
        .prepare('SELECT updated_at FROM provider_keys WHERE transport = ?')
        .get(transport) as { updated_at: number } | undefined;
      if (plaintext === null) {
        return { transport, hasKey: false, masked: null, updatedAt: null };
      }
      return {
        transport,
        hasKey: true,
        masked: mask(plaintext),
        updatedAt: row?.updated_at ?? null,
      };
    });
  }

  buildInfoRows(opts: { anthropicCliPresent: boolean; ollamaHost: string }): ReadonlyInfoRow[] {
    return [
      {
        transport: 'anthropic-oauth',
        label: 'Anthropic OAuth (via claude CLI)',
        status: opts.anthropicCliPresent ? 'detected' : 'no CLI on PATH',
      },
      {
        transport: 'ollama',
        label: 'Ollama',
        status: `Host: ${opts.ollamaHost}`,
      },
    ];
  }
}
```

Fix the typo in the snippet above — use `blob.authTag` consistently:

```ts
.run(transport, blob.ciphertext, blob.iv, blob.authTag, now);
```

- [ ] **Step 5: Run, expect GREEN**

```bash
npx vitest run server/domain/providers/key-vault.test.ts
```

Expected: 11 cases pass.

- [ ] **Step 6: Commit**

```bash
git add server/domain/providers/key-vault.types.ts server/domain/providers/key-vault.ts server/domain/providers/key-vault.test.ts
git commit -m "feat(slice-18): KeyVaultService — encrypted set/get/clear/listMasked"
```

---

## Task D1: KeyResolver (env-wins-over-vault)

**Files:**
- Create: `server/domain/providers/key-resolver.ts`
- Create: `server/domain/providers/key-resolver.test.ts`

- [ ] **Step 1: Failing tests** — `server/domain/providers/key-resolver.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import { KeyVaultService } from './key-vault';
import { KeyResolver } from './key-resolver';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let vault: KeyVaultService;
let resolver: KeyResolver;

beforeEach(() => {
  db = makeTestDb();
  vault = new KeyVaultService(db);
  resolver = new KeyResolver({
    vault,
    env: {
      ANTHROPIC_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
    },
  });
});
afterEach(() => db.close());

describe('KeyResolver.get', () => {
  it('returns undefined when neither env nor vault has the key', () => {
    expect(resolver.get('openai')).toBeUndefined();
  });

  it('returns vault key when env is empty', () => {
    vault.setKey('openai', 'sk-vault');
    expect(resolver.get('openai')).toBe('sk-vault');
  });

  it('env wins over vault', () => {
    vault.setKey('openai', 'sk-vault');
    const r = new KeyResolver({
      vault,
      env: {
        ANTHROPIC_API_KEY: undefined,
        OPENAI_API_KEY: 'sk-env',
        GEMINI_API_KEY: undefined,
      },
    });
    expect(r.get('openai')).toBe('sk-env');
  });

  it('returns vault gemini key when only vault is set', () => {
    vault.setKey('gemini', 'gk-vault');
    expect(resolver.get('gemini')).toBe('gk-vault');
  });

  it('returns vault anthropic key when only vault is set', () => {
    vault.setKey('anthropic', 'ak-vault');
    expect(resolver.get('anthropic')).toBe('ak-vault');
  });

  it('treats empty env string as unset', () => {
    const r = new KeyResolver({
      vault,
      env: { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '' },
    });
    vault.setKey('openai', 'sk-vault');
    expect(r.get('openai')).toBe('sk-vault');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/providers/key-resolver.test.ts
```

- [ ] **Step 3: Implement** — `server/domain/providers/key-resolver.ts`

```ts
import type { KeyVaultService } from './key-vault';
import type { VaultTransport } from './key-vault.types';

export interface KeyResolverEnv {
  ANTHROPIC_API_KEY: string | undefined;
  OPENAI_API_KEY: string | undefined;
  GEMINI_API_KEY: string | undefined;
}

export interface KeyResolverDeps {
  vault: KeyVaultService;
  env: KeyResolverEnv;
}

const ENV_VAR_BY_TRANSPORT: Record<VaultTransport, keyof KeyResolverEnv> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export class KeyResolver {
  constructor(private readonly deps: KeyResolverDeps) {}

  get(transport: VaultTransport): string | undefined {
    const envVar = this.deps.env[ENV_VAR_BY_TRANSPORT[transport]];
    if (envVar && envVar.length > 0) return envVar;
    const vaultKey = this.deps.vault.getKey(transport);
    return vaultKey ?? undefined;
  }
}
```

- [ ] **Step 4: Run, expect GREEN**

```bash
npx vitest run server/domain/providers/key-resolver.test.ts
```

Expected: 6 cases pass.

- [ ] **Step 5: Commit**

```bash
git add server/domain/providers/key-resolver.ts server/domain/providers/key-resolver.test.ts
git commit -m "feat(slice-18): KeyResolver — env-wins-over-vault resolution"
```

---

## Task E1: Refactor ProviderRegistry deps to use callbacks

**Files:**
- Modify: `server/domain/providers/registry.ts`
- Modify: `server/domain/providers/registry.test.ts`

This is a small refactor: replace fixed `geminiApiKey` / `openAIApiKey` / `anthropicAuth` with on-demand callbacks so each `refresh()` reads live values.

- [ ] **Step 1: Update `registry.ts` interface**

Replace the `ProviderRegistryDeps` interface:

```ts
export interface ProviderRegistryDeps {
  ollamaHost: string;
  resolveKey: (transport: 'gemini' | 'openai' | 'anthropic') => string | undefined;
  detectAnthropicAuth: () => Promise<'oauth' | 'apikey' | 'none'>;
  fakeProvider: AIProvider;
  geminiBuilder: (model: string) => AIProvider;
  ollamaBuilder: (model: string) => AIProvider;
  anthropicBuilder: (model: string) => AIProvider;
  openAIBuilder: (model: string) => AIProvider;
  defaultOverride?: string;
}
```

Update `refresh()`:

Replace `if (this.deps.geminiApiKey) {` with `if (this.deps.resolveKey('gemini')) {`.
Replace `if (this.deps.openAIApiKey) {` with `if (this.deps.resolveKey('openai')) {`.
Replace the anthropic block:

```ts
// Anthropic
const auth = await this.deps.detectAnthropicAuth();
if (auth !== 'none') {
  for (const model of anthropicHardcodedModels()) {
    const provider = this.deps.anthropicBuilder(model);
    next.set(`anthropic:${model}`, {
      provider,
      descriptor: {
        name: `anthropic:${model}`,
        transport: 'anthropic',
        model,
        capabilities: provider.capabilities,
        displayName: displayNameFor('anthropic', model),
      },
    });
  }
}
```

- [ ] **Step 2: Update test fixtures**

In `server/domain/providers/registry.test.ts`, replace the `baseDeps()` helper:

```ts
function baseDeps(
  overrides: Partial<ConstructorParameters<typeof ProviderRegistry>[0]> = {},
): ConstructorParameters<typeof ProviderRegistry>[0] {
  return {
    ollamaHost: 'http://localhost:11434',
    resolveKey: () => undefined,
    detectAnthropicAuth: async () => 'none' as const,
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    ollamaBuilder: () => makeFake('o'),
    anthropicBuilder: (model: string) => makeFake(model),
    openAIBuilder: (model: string) => makeFake(model),
    ...overrides,
  };
}
```

Then update each test that previously set `geminiApiKey`/`openAIApiKey`/`anthropicAuth` to use the callbacks instead. For example:

```ts
// Before
baseDeps({ geminiApiKey: 'sk-...', geminiBuilder: (model) => makeFake(model) })
// After
baseDeps({ resolveKey: (t) => (t === 'gemini' ? 'sk-...' : undefined), geminiBuilder: (model) => makeFake(model) })
```

Apply the same substitution everywhere `anthropicAuth`, `geminiApiKey`, `openAIApiKey` appear in the test file.

- [ ] **Step 3: Run, expect GREEN**

```bash
npx vitest run server/domain/providers/registry.test.ts
```

Expected: all existing cases pass with the new signature.

- [ ] **Step 4: Commit**

```bash
git add server/domain/providers/registry.ts server/domain/providers/registry.test.ts
git commit -m "refactor(slice-18): ProviderRegistry reads keys via callback so refresh is live"
```

---

## Task F1: Refactor AuthStatusService deps to use callbacks

**Files:**
- Modify: `server/domain/providers/auth-status.ts`
- Modify: `server/domain/providers/auth-status.test.ts`

Same idea as E1 but for `AuthStatusService`.

- [ ] **Step 1: Update `auth-status.ts`**

Replace the constructor deps:

```ts
export interface AuthStatusServiceDeps {
  detectAnthropicAuth: () => Promise<'oauth' | 'apikey' | 'none'>;
  getOpenAIKey: () => string | undefined;
  getGeminiKey: () => string | undefined;
  ollamaHost: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
```

Inside `probeOpenAI()`, replace `this.deps.openAIApiKey` reads with `this.deps.getOpenAIKey()`. Similarly for `probeGemini()`.

- [ ] **Step 2: Update tests**

In `server/domain/providers/auth-status.test.ts`, in the `makeService` helper:

```ts
function makeService(overrides: Partial<ConstructorParameters<typeof AuthStatusService>[0]> = {}) {
  return new AuthStatusService({
    detectAnthropicAuth: async () => 'none',
    getOpenAIKey: () => undefined,
    getGeminiKey: () => undefined,
    ollamaHost: 'http://localhost:11434',
    fetch: vi.fn(async () => new Response(null, { status: 599 })) as unknown as typeof fetch,
    timeoutMs: 50,
    ...overrides,
  });
}
```

Replace each call-site that passed `openAIApiKey: 'sk-x'` with `getOpenAIKey: () => 'sk-x'` (and similarly for Gemini). The structure is otherwise unchanged.

- [ ] **Step 3: Run, expect GREEN**

```bash
npx vitest run server/domain/providers/auth-status.test.ts
```

Expected: all 5 existing cases pass.

- [ ] **Step 4: Commit**

```bash
git add server/domain/providers/auth-status.ts server/domain/providers/auth-status.test.ts
git commit -m "refactor(slice-18): AuthStatusService reads keys via callback so probe is live"
```

---

## Task G1: Vault routes (GET list, GET reveal, PUT, DELETE)

**Files:**
- Modify: `server/routes/providers.routes.ts`
- Modify: `server/routes/providers.routes.test.ts`

- [ ] **Step 1: Append failing tests** to `server/routes/providers.routes.test.ts`

```ts
import { KeyVaultService } from '@/server/domain/providers/key-vault';
import type { TransportStatus } from '@/server/domain/providers/auth-status.types';
import { makeTestDb } from '@/server/test/test-db';

function makeAppWithVault(opts?: { probeOk?: boolean }) {
  const db = makeTestDb();
  const vault = new KeyVaultService(db);

  const refreshSpy = vi.fn(async () => {});
  const probeSpy = vi.fn(async (transports?: string[]): Promise<{ statuses: TransportStatus[]; checkedAt: number }> => {
    const status: TransportStatus = {
      transport: (transports?.[0] ?? 'openai') as TransportStatus['transport'],
      state: opts?.probeOk === false ? 'unconfigured' : 'ok',
      reason: opts?.probeOk === false ? 'no api key' : 'api key set',
    };
    return { statuses: [status], checkedAt: Date.now() };
  });

  const registry = {
    list: () => [],
    refresh: refreshSpy,
    defaultName: () => null,
  } as unknown as Parameters<typeof createProvidersRoutes>[0];

  const authStatusService = { probe: probeSpy } as unknown as Parameters<typeof createProvidersRoutes>[1];

  const app = express();
  app.use(express.json());
  app.use('/api/providers', createProvidersRoutes(registry, authStatusService, vault, {
    setAnthropicEnv: () => {},
  }));
  return { app, vault, refreshSpy, probeSpy, db };
}

describe('providers routes — key vault', () => {
  it('GET /keys returns 3 vault rows + 2 info rows', async () => {
    const { app } = makeAppWithVault();
    const res = await request(app).get('/api/providers/keys');
    expect(res.status).toBe(200);
    expect(res.body.vault).toHaveLength(3);
    expect(res.body.info).toHaveLength(2);
    expect(res.body.vault.every((r: { hasKey: boolean }) => r.hasKey === false)).toBe(true);
  });

  it('PUT /keys/openai stores the key, triggers refresh + probe, returns masked row + status', async () => {
    const { app, vault, refreshSpy, probeSpy } = makeAppWithVault();
    const res = await request(app)
      .put('/api/providers/keys/openai')
      .send({ key: 'sk-openai-test-12345' });
    expect(res.status).toBe(200);
    expect(res.body.row.transport).toBe('openai');
    expect(res.body.row.hasKey).toBe(true);
    expect(res.body.row.masked).toBe('sk-…2345');
    expect(res.body.status.transport).toBe('openai');
    expect(res.body.status.state).toBe('ok');
    expect(refreshSpy).toHaveBeenCalled();
    expect(probeSpy).toHaveBeenCalledWith(['openai']);
    expect(vault.getKey('openai')).toBe('sk-openai-test-12345');
  });

  it('PUT /keys/openai with empty body returns 400', async () => {
    const { app } = makeAppWithVault();
    const res = await request(app).put('/api/providers/keys/openai').send({});
    expect(res.status).toBe(400);
  });

  it('PUT /keys/invalid returns 400', async () => {
    const { app } = makeAppWithVault();
    const res = await request(app).put('/api/providers/keys/invalid').send({ key: 'x' });
    expect(res.status).toBe(400);
  });

  it('DELETE /keys/openai clears + re-probes', async () => {
    const { app, vault, probeSpy } = makeAppWithVault({ probeOk: false });
    vault.setKey('openai', 'sk-x');
    const res = await request(app).delete('/api/providers/keys/openai');
    expect(res.status).toBe(200);
    expect(res.body.status.state).toBe('unconfigured');
    expect(probeSpy).toHaveBeenCalledWith(['openai']);
    expect(vault.getKey('openai')).toBeNull();
  });

  it('GET /keys/openai?reveal=1 returns plaintext after set', async () => {
    const { app, vault } = makeAppWithVault();
    vault.setKey('openai', 'sk-revealed');
    const res = await request(app).get('/api/providers/keys/openai').query({ reveal: '1' });
    expect(res.status).toBe(200);
    expect(res.body.plaintext).toBe('sk-revealed');
  });

  it('GET /keys/openai?reveal=1 returns 404 when not set', async () => {
    const { app } = makeAppWithVault();
    const res = await request(app).get('/api/providers/keys/openai').query({ reveal: '1' });
    expect(res.status).toBe(404);
  });

  it('GET /keys/openai without reveal=1 returns 400', async () => {
    const { app } = makeAppWithVault();
    const res = await request(app).get('/api/providers/keys/openai');
    expect(res.status).toBe(400);
  });

  it('all 4 routes return 503 when keyVault is absent', async () => {
    const registry = {
      list: () => [],
      refresh: vi.fn(),
      defaultName: () => null,
    } as unknown as Parameters<typeof createProvidersRoutes>[0];
    const app = express();
    app.use(express.json());
    app.use('/api/providers', createProvidersRoutes(registry));
    expect((await request(app).get('/api/providers/keys')).status).toBe(503);
    expect((await request(app).get('/api/providers/keys/openai').query({ reveal: '1' })).status).toBe(503);
    expect((await request(app).put('/api/providers/keys/openai').send({ key: 'x' })).status).toBe(503);
    expect((await request(app).delete('/api/providers/keys/openai')).status).toBe(503);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (routes don't exist yet)

```bash
npx vitest run server/routes/providers.routes.test.ts
```

- [ ] **Step 3: Extend `providers.routes.ts`**

Add imports at top:

```ts
import type { KeyVaultService } from '@/server/domain/providers/key-vault';
import type { VaultTransport, MaskedKeyRow, ReadonlyInfoRow } from '@/server/domain/providers/key-vault.types';
import { VAULT_TRANSPORTS } from '@/server/domain/providers/key-vault.types';
import { ValidationError } from '@/server/lib/errors';

export interface KeyVaultHooks {
  /** Called on save/clear of anthropic key so the SDK picks up the new value. */
  setAnthropicEnv: (key: string | null) => void;
}
```

Change the factory signature:

```ts
export function createProvidersRoutes(
  registry: ProviderRegistry,
  authStatusService?: AuthStatusService,
  keyVault?: KeyVaultService,
  hooks?: KeyVaultHooks,
  buildInfoRowsCtx?: { anthropicCliPresent: boolean; ollamaHost: string },
): Router {
  const router = Router();
  // ... existing code unchanged through auth-status routes ...

  const requireVault = (res: Response): KeyVaultService | null => {
    if (!keyVault) {
      res.status(503).json({ error: { code: 'NO_KEY_VAULT', message: 'Key vault not configured' } });
      return null;
    }
    return keyVault;
  };

  const isValidTransport = (t: string): t is VaultTransport =>
    (VAULT_TRANSPORTS as readonly string[]).includes(t);

  router.get(
    '/keys',
    asyncHandler(async (_req, res) => {
      const vault = requireVault(res);
      if (!vault) return;
      const ctx = buildInfoRowsCtx ?? { anthropicCliPresent: false, ollamaHost: '' };
      const body = { vault: vault.listMasked(), info: vault.buildInfoRows(ctx) };
      res.json(body);
    }),
  );

  router.get(
    '/keys/:transport',
    asyncHandler(async (req, res) => {
      const vault = requireVault(res);
      if (!vault) return;
      const { transport } = req.params;
      if (!isValidTransport(transport)) throw new ValidationError('Unknown transport');
      if (req.query.reveal !== '1') throw new ValidationError('reveal=1 required');
      const plaintext = vault.getKey(transport);
      if (plaintext === null) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Key not set' } });
        return;
      }
      res.json({ plaintext });
    }),
  );

  router.put(
    '/keys/:transport',
    asyncHandler(async (req, res) => {
      const vault = requireVault(res);
      if (!vault) return;
      const { transport } = req.params;
      if (!isValidTransport(transport)) throw new ValidationError('Unknown transport');
      const key = req.body?.key;
      if (typeof key !== 'string' || key.length === 0) throw new ValidationError('Key required');
      vault.setKey(transport, key);
      if (transport === 'anthropic') hooks?.setAnthropicEnv(key);
      await registry.refresh();
      const probe = authStatusService ? await authStatusService.probe([transport]) : null;
      const row = vault.listMasked().find((r) => r.transport === transport) as MaskedKeyRow;
      res.json({ row, status: probe?.statuses[0] ?? null });
    }),
  );

  router.delete(
    '/keys/:transport',
    asyncHandler(async (req, res) => {
      const vault = requireVault(res);
      if (!vault) return;
      const { transport } = req.params;
      if (!isValidTransport(transport)) throw new ValidationError('Unknown transport');
      vault.clearKey(transport);
      if (transport === 'anthropic') hooks?.setAnthropicEnv(null);
      await registry.refresh();
      const probe = authStatusService ? await authStatusService.probe([transport]) : null;
      res.json({ status: probe?.statuses[0] ?? null });
    }),
  );

  return router;
}
```

- [ ] **Step 4: Run, expect GREEN**

```bash
npx vitest run server/routes/providers.routes.test.ts
```

Expected: all existing + 9 new cases pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/providers.routes.ts server/routes/providers.routes.test.ts
git commit -m "feat(slice-18): vault routes — GET list, GET reveal, PUT, DELETE (with live refresh + probe)"
```

---

## Task H1: Wire vault + resolver into createApp + bootstrap

**Files:**
- Modify: `server/app.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Update `server/app.ts`**

Add imports:

```ts
import type { KeyVaultService } from './domain/providers/key-vault';
import type { KeyVaultHooks } from './routes/providers.routes';
```

Extend `AppDeps`:

```ts
export interface AppDeps {
  // ...existing fields...
  keyVault?: KeyVaultService;
  keyVaultHooks?: KeyVaultHooks;
  buildInfoRowsCtx?: { anthropicCliPresent: boolean; ollamaHost: string };
}
```

Update the providers mount:

```ts
if (deps.providers) {
  app.use(
    '/api/providers',
    createProvidersRoutes(deps.providers, deps.authStatusService, deps.keyVault, deps.keyVaultHooks, deps.buildInfoRowsCtx),
  );
}
```

- [ ] **Step 2: Update `server/index.ts`**

Add imports:

```ts
import { KeyVaultService } from './domain/providers/key-vault';
import { KeyResolver } from './domain/providers/key-resolver';
```

Restructure the bootstrap. Replace the existing `providers` and `authStatusService` construction with:

```ts
  // ... after migrations + contextStore/historyStore/etc ...

  const keyVault = new KeyVaultService(db);

  // Cold-start anthropic env priming: if vault has an anthropic key and env doesn't,
  // set process.env.ANTHROPIC_API_KEY BEFORE detectAnthropicAuth() runs.
  if (!process.env.ANTHROPIC_API_KEY) {
    const stored = keyVault.getKey('anthropic');
    if (stored) process.env.ANTHROPIC_API_KEY = stored;
  }

  const resolver = new KeyResolver({
    vault: keyVault,
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: cfg.openAIApiKey || undefined,
      GEMINI_API_KEY: cfg.geminiApiKey || undefined,
    },
  });

  const ollamaHost = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

  const providers = new ProviderRegistry({
    ollamaHost,
    resolveKey: (t) => resolver.get(t),
    detectAnthropicAuth,
    fakeProvider,
    geminiBuilder: (model) => new GeminiProvider({ apiKey: resolver.get('gemini') ?? '', model }),
    ollamaBuilder: (model) => new OllamaProvider({ host: ollamaHost, model }),
    anthropicBuilder: (model) =>
      new AnthropicProvider({
        model: model as 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5',
      }),
    openAIBuilder: (model) =>
      new OpenAIProvider({
        apiKey: resolver.get('openai') ?? '',
        model: model as 'gpt-5' | 'gpt-5-mini' | 'gpt-4.1' | 'o3',
      }),
    defaultOverride:
      process.env.AETHER_DEFAULT_PROVIDER ||
      (cfg.fakeProvider ? 'fake:default' : undefined),
  });

  await providers.refresh();

  const authStatusService = new AuthStatusService({
    detectAnthropicAuth,
    getOpenAIKey: () => resolver.get('openai'),
    getGeminiKey: () => resolver.get('gemini'),
    ollamaHost,
  });

  // Detect claude CLI once for info row label
  const anthropicCliPresent = await detectAnthropicAuth().then((a) => a !== 'none' || Boolean(process.env.PATH));
  // (Simpler heuristic: anthropicAuth from above already indicates whether CLI works.)
  const buildInfoRowsCtx = { anthropicCliPresent, ollamaHost };

  const keyVaultHooks = {
    setAnthropicEnv: (key: string | null) => {
      if (key) process.env.ANTHROPIC_API_KEY = key;
      else delete process.env.ANTHROPIC_API_KEY;
    },
  };

  const dispatcher = new DispatchService({ providers, historyStore, contextStore, subAgentsStore, mcpRegistry });

  const app = createApp({
    contextStore, historyStore, dispatcher, profilesStore, subAgentsStore,
    mcpRegistry, providers, searchService, authStatusService,
    keyVault, keyVaultHooks, buildInfoRowsCtx,
  });
```

(Remove the previous `geminiApiKey`/`openAIApiKey`/`anthropicAuth` constructor args — they're now resolved via callback.)

- [ ] **Step 3: Run server tests**

```bash
npx vitest run server/
```

Expected: all pass (the pre-existing Ollama flake may still fail on machines with a live Ollama daemon — that's unrelated).

- [ ] **Step 4: Commit**

```bash
git add server/app.ts server/index.ts
git commit -m "feat(slice-18): wire KeyVaultService + KeyResolver through createApp + bootstrap"
```

---

## Task I1: FE types + providers.api extensions

**Files:**
- Create: `src/types/key-vault.types.ts`
- Modify: `src/lib/api/providers.api.ts`
- Modify: `src/lib/api/providers.api.test.ts`

- [ ] **Step 1: Create FE types**

`src/types/key-vault.types.ts`:

```ts
export type VaultTransport = 'anthropic' | 'openai' | 'gemini';
export type InfoTransport = 'anthropic-oauth' | 'ollama';

export const VAULT_TRANSPORTS: readonly VaultTransport[] = ['anthropic', 'openai', 'gemini'];

export interface MaskedKeyRow {
  transport: VaultTransport;
  hasKey: boolean;
  masked: string | null;
  updatedAt: number | null;
}

export interface ReadonlyInfoRow {
  transport: InfoTransport;
  label: string;
  status: string;
}

export interface KeyVaultListResponse {
  vault: MaskedKeyRow[];
  info: ReadonlyInfoRow[];
}

export interface SaveKeyResponse {
  row: MaskedKeyRow;
  status: { transport: string; state: 'ok' | 'unconfigured' | 'error'; reason: string; detail?: string } | null;
}
```

- [ ] **Step 2: Append failing tests** to `src/lib/api/providers.api.test.ts`

```ts
import type { KeyVaultListResponse } from '@/src/types/key-vault.types';

describe('providersApi.listKeys', () => {
  it('GETs the keys and returns parsed payload', async () => {
    const body: KeyVaultListResponse = {
      vault: [
        { transport: 'anthropic', hasKey: false, masked: null, updatedAt: null },
        { transport: 'openai', hasKey: true, masked: 'sk-…aB3x', updatedAt: 1 },
        { transport: 'gemini', hasKey: false, masked: null, updatedAt: null },
      ],
      info: [
        { transport: 'anthropic-oauth', label: 'Anthropic OAuth', status: 'detected' },
        { transport: 'ollama', label: 'Ollama', status: 'Host: http://localhost:11434' },
      ],
    };
    server.use(
      http.get('http://localhost/api/providers/keys', () => HttpResponse.json(body)),
    );
    const got = await providersApi.listKeys();
    expect(got.vault).toHaveLength(3);
    expect(got.info).toHaveLength(2);
  });
});

describe('providersApi.setKey', () => {
  it('PUTs and returns row + status', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.put('http://localhost/api/providers/keys/openai', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          row: { transport: 'openai', hasKey: true, masked: 'sk-…2345', updatedAt: 1 },
          status: { transport: 'openai', state: 'ok', reason: 'api key set' },
        });
      }),
    );
    const got = await providersApi.setKey('openai', 'sk-test-12345');
    expect(got.row.masked).toBe('sk-…2345');
    expect(got.status?.state).toBe('ok');
    expect(receivedBody).toEqual({ key: 'sk-test-12345' });
  });
});

describe('providersApi.clearKey', () => {
  it('DELETEs and returns status', async () => {
    server.use(
      http.delete('http://localhost/api/providers/keys/openai', () =>
        HttpResponse.json({ status: { transport: 'openai', state: 'unconfigured', reason: 'no api key' } }),
      ),
    );
    const got = await providersApi.clearKey('openai');
    expect(got.status?.state).toBe('unconfigured');
  });
});

describe('providersApi.revealKey', () => {
  it('GETs with reveal=1 and returns plaintext', async () => {
    let urlSeen = '';
    server.use(
      http.get('http://localhost/api/providers/keys/openai', ({ request }) => {
        urlSeen = request.url;
        return HttpResponse.json({ plaintext: 'sk-revealed' });
      }),
    );
    const got = await providersApi.revealKey('openai');
    expect(got).toBe('sk-revealed');
    expect(urlSeen).toMatch(/reveal=1/);
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run src/lib/api/providers.api.test.ts
```

- [ ] **Step 4: Implement** — extend `src/lib/api/providers.api.ts`

Add imports:

```ts
import type { KeyVaultListResponse, SaveKeyResponse, VaultTransport } from '@/src/types/key-vault.types';
```

Add to the `providersApi` object literal:

```ts
listKeys: (): Promise<KeyVaultListResponse> =>
  fetch('/api/providers/keys').then(jsonRes<KeyVaultListResponse>),

setKey: (transport: VaultTransport, key: string): Promise<SaveKeyResponse> =>
  fetch(`/api/providers/keys/${transport}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  }).then(jsonRes<SaveKeyResponse>),

clearKey: (transport: VaultTransport): Promise<{ status: SaveKeyResponse['status'] }> =>
  fetch(`/api/providers/keys/${transport}`, { method: 'DELETE' })
    .then(jsonRes<{ status: SaveKeyResponse['status'] }>),

revealKey: (transport: VaultTransport): Promise<string> =>
  fetch(`/api/providers/keys/${transport}?reveal=1`)
    .then(jsonRes<{ plaintext: string }>)
    .then((b) => b.plaintext),
```

- [ ] **Step 5: Run, expect GREEN**

```bash
npx vitest run src/lib/api/providers.api.test.ts
```

Expected: all (existing + 4 new) cases pass.

- [ ] **Step 6: Commit**

```bash
git add src/types/key-vault.types.ts src/lib/api/providers.api.ts src/lib/api/providers.api.test.ts
git commit -m "feat(slice-18): providersApi.listKeys/setKey/clearKey/revealKey"
```

---

## Task J1: keyVault store

**Files:**
- Create: `src/stores/keyVault.store.ts`
- Create: `src/stores/keyVault.store.test.ts`

- [ ] **Step 1: Failing tests** — `src/stores/keyVault.store.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useKeyVaultStore } from './keyVault.store';
import { useProvidersStore } from './providers.store';
import { useProviderAuthStore } from './providerAuth.store';

beforeEach(() => {
  useKeyVaultStore.getState()._reset();
});
afterEach(() => server.resetHandlers());

const fullList = () => ({
  vault: [
    { transport: 'anthropic', hasKey: false, masked: null, updatedAt: null },
    { transport: 'openai', hasKey: true, masked: 'sk-…aB3x', updatedAt: 1 },
    { transport: 'gemini', hasKey: false, masked: null, updatedAt: null },
  ],
  info: [
    { transport: 'anthropic-oauth', label: 'Anthropic OAuth', status: 'detected' },
    { transport: 'ollama', label: 'Ollama', status: 'Host: http://localhost:11434' },
  ],
});

describe('useKeyVaultStore.init', () => {
  it('populates vault + info and clears loading', async () => {
    server.use(
      http.get('http://localhost/api/providers/keys', () => HttpResponse.json(fullList())),
    );
    await useKeyVaultStore.getState().init();
    const s = useKeyVaultStore.getState();
    expect(s.vault).toHaveLength(3);
    expect(s.info).toHaveLength(2);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });
});

describe('useKeyVaultStore.save', () => {
  it('PUTs, replaces the row, and triggers downstream refreshes', async () => {
    const providersInitSpy = vi.fn(async () => {});
    const authRefreshSpy = vi.fn(async () => {});
    useProvidersStore.setState({ init: providersInitSpy });
    useProviderAuthStore.setState({ refresh: authRefreshSpy });

    server.use(
      http.get('http://localhost/api/providers/keys', () => HttpResponse.json(fullList())),
      http.put('http://localhost/api/providers/keys/openai', () =>
        HttpResponse.json({
          row: { transport: 'openai', hasKey: true, masked: 'sk-…2345', updatedAt: 99 },
          status: { transport: 'openai', state: 'ok', reason: 'api key set' },
        }),
      ),
    );
    await useKeyVaultStore.getState().init();
    await useKeyVaultStore.getState().save('openai', 'sk-new-12345');
    const oa = useKeyVaultStore.getState().vault.find((r) => r.transport === 'openai')!;
    expect(oa.masked).toBe('sk-…2345');
    expect(providersInitSpy).toHaveBeenCalled();
    expect(authRefreshSpy).toHaveBeenCalledWith('openai');
  });

  it('sets error on network failure and keeps the row unchanged', async () => {
    server.use(
      http.get('http://localhost/api/providers/keys', () => HttpResponse.json(fullList())),
      http.put('http://localhost/api/providers/keys/openai', () => HttpResponse.error()),
    );
    await useKeyVaultStore.getState().init();
    await useKeyVaultStore.getState().save('openai', 'sk-x');
    expect(useKeyVaultStore.getState().error).not.toBeNull();
  });
});

describe('useKeyVaultStore.clear', () => {
  it('DELETEs and marks the row hasKey=false', async () => {
    server.use(
      http.get('http://localhost/api/providers/keys', () => HttpResponse.json(fullList())),
      http.delete('http://localhost/api/providers/keys/openai', () =>
        HttpResponse.json({ status: { transport: 'openai', state: 'unconfigured', reason: 'no api key' } }),
      ),
    );
    await useKeyVaultStore.getState().init();
    await useKeyVaultStore.getState().clear('openai');
    const oa = useKeyVaultStore.getState().vault.find((r) => r.transport === 'openai')!;
    expect(oa.hasKey).toBe(false);
    expect(oa.masked).toBeNull();
  });
});

describe('useKeyVaultStore.reveal', () => {
  it('returns plaintext from the server and does not store it in state', async () => {
    server.use(
      http.get('http://localhost/api/providers/keys/openai', () =>
        HttpResponse.json({ plaintext: 'sk-secret' }),
      ),
    );
    const text = await useKeyVaultStore.getState().reveal('openai');
    expect(text).toBe('sk-secret');
    // Confirm the store state does not contain the plaintext anywhere.
    const stateJson = JSON.stringify(useKeyVaultStore.getState());
    expect(stateJson.includes('sk-secret')).toBe(false);
  });
});

describe('useKeyVaultStore.save dedupe', () => {
  it('two simultaneous save calls for the same transport only fire one PUT', async () => {
    let puts = 0;
    server.use(
      http.put('http://localhost/api/providers/keys/openai', async () => {
        puts++;
        await new Promise((r) => setTimeout(r, 30));
        return HttpResponse.json({
          row: { transport: 'openai', hasKey: true, masked: 'sk-…2345', updatedAt: 1 },
          status: null,
        });
      }),
    );
    const a = useKeyVaultStore.getState().save('openai', 'sk-1');
    const b = useKeyVaultStore.getState().save('openai', 'sk-2');
    await Promise.all([a, b]);
    expect(puts).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing)

```bash
npx vitest run src/stores/keyVault.store.test.ts
```

- [ ] **Step 3: Implement** — `src/stores/keyVault.store.ts`

```ts
import { create } from 'zustand';
import { providersApi } from '@/src/lib/api/providers.api';
import { useProvidersStore } from './providers.store';
import { useProviderAuthStore } from './providerAuth.store';
import type {
  MaskedKeyRow,
  ReadonlyInfoRow,
  VaultTransport,
} from '@/src/types/key-vault.types';

interface KeyVaultState {
  vault: MaskedKeyRow[];
  info: ReadonlyInfoRow[];
  loading: boolean;
  error: string | null;

  init(): Promise<void>;
  save(transport: VaultTransport, key: string): Promise<void>;
  clear(transport: VaultTransport): Promise<void>;
  reveal(transport: VaultTransport): Promise<string>;
  _reset(): void;
}

const initial = {
  vault: [] as MaskedKeyRow[],
  info: [] as ReadonlyInfoRow[],
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

const inflight = new Map<string, Promise<unknown>>();

export const useKeyVaultStore = create<KeyVaultState>((set, get) => ({
  ...initial,
  _reset: () => { inflight.clear(); set(initial); },

  init: async () => {
    set({ loading: true, error: null });
    try {
      const body = await providersApi.listKeys();
      set({ vault: body.vault, info: body.info, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  save: async (transport, key) => {
    const dedupeKey = `save:${transport}`;
    const existing = inflight.get(dedupeKey);
    if (existing) { await existing.catch(() => {}); return; }
    set({ loading: true, error: null });
    const promise = providersApi.setKey(transport, key);
    inflight.set(dedupeKey, promise);
    try {
      const body = await promise;
      set((s) => ({
        vault: s.vault.map((r) => (r.transport === transport ? body.row : r)),
        loading: false,
        error: null,
      }));
      // Cross-store side effects (fire-and-forget).
      void useProvidersStore.getState().init();
      void useProviderAuthStore.getState().refresh(transport);
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    } finally {
      inflight.delete(dedupeKey);
    }
  },

  clear: async (transport) => {
    const dedupeKey = `clear:${transport}`;
    const existing = inflight.get(dedupeKey);
    if (existing) { await existing.catch(() => {}); return; }
    set({ loading: true, error: null });
    const promise = providersApi.clearKey(transport);
    inflight.set(dedupeKey, promise);
    try {
      await promise;
      set((s) => ({
        vault: s.vault.map((r) =>
          r.transport === transport
            ? { transport, hasKey: false, masked: null, updatedAt: null }
            : r,
        ),
        loading: false,
        error: null,
      }));
      void useProvidersStore.getState().init();
      void useProviderAuthStore.getState().refresh(transport);
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    } finally {
      inflight.delete(dedupeKey);
    }
  },

  reveal: async (transport) => {
    return providersApi.revealKey(transport);
  },
}));
```

- [ ] **Step 4: Run, expect GREEN**

```bash
npx vitest run src/stores/keyVault.store.test.ts
```

Expected: 6 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/keyVault.store.ts src/stores/keyVault.store.test.ts
git commit -m "feat(slice-18): keyVault store — init/save/clear/reveal + cross-store refresh"
```

---

## Task K1: ui.store keyVault state + palette command

**Files:**
- Modify: `src/stores/ui.store.ts`
- Modify: `src/stores/ui.store.test.ts`
- Modify: `src/hooks/useCommands.ts`
- Modify: `src/hooks/useCommands.test.ts`

- [ ] **Step 1: Append failing tests** to `src/stores/ui.store.test.ts`

```ts
describe('useUiStore.keyVault', () => {
  it('keyVaultOpen defaults false, focus null', () => {
    const s = useUiStore.getState();
    expect(s.keyVaultOpen).toBe(false);
    expect(s.keyVaultFocusTransport).toBeNull();
  });

  it('openKeyVault sets open=true and stores focus', () => {
    useUiStore.getState().openKeyVault('openai');
    const s = useUiStore.getState();
    expect(s.keyVaultOpen).toBe(true);
    expect(s.keyVaultFocusTransport).toBe('openai');
  });

  it('openKeyVault with no arg sets focus to null', () => {
    useUiStore.getState().openKeyVault();
    expect(useUiStore.getState().keyVaultFocusTransport).toBeNull();
  });

  it('closeKeyVault resets state', () => {
    useUiStore.setState({ keyVaultOpen: true, keyVaultFocusTransport: 'gemini' });
    useUiStore.getState().closeKeyVault();
    const s = useUiStore.getState();
    expect(s.keyVaultOpen).toBe(false);
    expect(s.keyVaultFocusTransport).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/stores/ui.store.test.ts
```

- [ ] **Step 3: Extend `ui.store.ts`**

Add to the interface:

```ts
keyVaultOpen: boolean;
keyVaultFocusTransport: 'anthropic' | 'openai' | 'gemini' | null;
openKeyVault(focus?: 'anthropic' | 'openai' | 'gemini'): void;
closeKeyVault(): void;
```

Add to `initial`:

```ts
keyVaultOpen: false,
keyVaultFocusTransport: null as 'anthropic' | 'openai' | 'gemini' | null,
```

Add the actions:

```ts
openKeyVault: (focus) => set({ keyVaultOpen: true, keyVaultFocusTransport: focus ?? null }),
closeKeyVault: () => set({ keyVaultOpen: false, keyVaultFocusTransport: null }),
```

- [ ] **Step 4: Run UI store tests, expect GREEN**

```bash
npx vitest run src/stores/ui.store.test.ts
```

- [ ] **Step 5: Append palette command test** to `src/hooks/useCommands.test.ts`

```ts
describe('useCommands — keys.configure', () => {
  it('exposes a "Configure API keys…" command that opens the key vault', async () => {
    const { result } = renderHook(() => useCommands());
    const cmd = result.current.find((c) => c.id === 'keys.configure');
    expect(cmd).toBeDefined();
    expect(cmd!.label).toBe('Configure API keys…');
    await cmd!.run();
    expect(useUiStore.getState().keyVaultOpen).toBe(true);
  });
});
```

Add imports to the test file if missing.

- [ ] **Step 6: Add the command** in `src/hooks/useCommands.ts`

Add `KeyRound` (or `KeyIcon`) to lucide imports. In the Sessions group (or a new group — keep it in profiles for now since the modal lives there), append:

```ts
out.push({
  id: 'keys.configure',
  group: 'profiles',
  label: 'Configure API keys…',
  icon: KeyRound,
  run: async () => {
    useUiStore.getState().openKeyVault();
  },
});
```

If the existing `commands.types.ts` group type doesn't include 'profiles', the command already uses an existing group (the palette has Sessions/Profiles/UI/Context groups). Keep it under `'profiles'`.

- [ ] **Step 7: Run useCommands tests, expect GREEN**

```bash
npx vitest run src/hooks/useCommands.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/stores/ui.store.ts src/stores/ui.store.test.ts src/hooks/useCommands.ts src/hooks/useCommands.test.ts
git commit -m "feat(slice-18): ui.store keyVault state + palette command Configure API keys…"
```

---

## Task L1: KeyVaultModal component

**Files:**
- Create: `src/components/profiles/KeyVaultModal.tsx`
- Create: `src/components/profiles/KeyVaultModal.test.tsx`

- [ ] **Step 1: Failing tests** — `src/components/profiles/KeyVaultModal.test.tsx`

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { KeyVaultModal } from './KeyVaultModal';
import { useUiStore } from '@/src/stores/ui.store';
import { useKeyVaultStore } from '@/src/stores/keyVault.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';

const populatedList = () => ({
  vault: [
    { transport: 'anthropic', hasKey: false, masked: null, updatedAt: null },
    { transport: 'openai', hasKey: true, masked: 'sk-…aB3x', updatedAt: 1 },
    { transport: 'gemini', hasKey: false, masked: null, updatedAt: null },
  ],
  info: [
    { transport: 'anthropic-oauth', label: 'Anthropic OAuth', status: 'detected' },
    { transport: 'ollama', label: 'Ollama', status: 'Host: http://localhost:11434' },
  ],
});

beforeEach(() => {
  useUiStore.getState()._reset();
  useKeyVaultStore.getState()._reset();
  useUiStore.setState({ keyVaultOpen: true });
  server.use(
    http.get('http://localhost/api/providers/keys', () => HttpResponse.json(populatedList())),
  );
});

describe('KeyVaultModal', () => {
  it('renders 5 rows in fixed order when open', async () => {
    render(<KeyVaultModal />);
    await waitFor(() => {
      const rows = screen.getAllByTestId('key-vault-row');
      expect(rows).toHaveLength(5);
    });
    const rows = screen.getAllByTestId('key-vault-row');
    expect(rows[0]).toHaveTextContent(/anthropic/i);
    expect(rows[1]).toHaveTextContent(/oauth/i);
    expect(rows[2]).toHaveTextContent(/openai/i);
    expect(rows[3]).toHaveTextContent(/gemini/i);
    expect(rows[4]).toHaveTextContent(/ollama/i);
  });

  it('renders nothing when keyVaultOpen=false', () => {
    useUiStore.setState({ keyVaultOpen: false });
    const { container } = render(<KeyVaultModal />);
    expect(container.querySelector('[data-testid="key-vault-row"]')).toBeNull();
  });

  it('Save calls useKeyVaultStore.save with the typed key', async () => {
    const saveSpy = vi.fn(async () => {});
    useKeyVaultStore.setState({ save: saveSpy });
    render(<KeyVaultModal />);
    await waitFor(() => expect(screen.getAllByTestId('key-vault-row')).toHaveLength(5));
    const input = screen.getByLabelText(/anthropic key/i) as HTMLInputElement;
    const user = userEvent.setup();
    await user.type(input, 'ak-test');
    await user.click(screen.getByRole('button', { name: /save anthropic/i }));
    expect(saveSpy).toHaveBeenCalledWith('anthropic', 'ak-test');
  });

  it('Clear is two-click confirmation', async () => {
    const clearSpy = vi.fn(async () => {});
    useKeyVaultStore.setState({ clear: clearSpy });
    render(<KeyVaultModal />);
    await waitFor(() => expect(screen.getAllByTestId('key-vault-row')).toHaveLength(5));
    const user = userEvent.setup();
    const clearBtn = screen.getByRole('button', { name: /clear openai/i });
    await user.click(clearBtn);
    expect(clearSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /confirm clear/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm clear/i }));
    expect(clearSpy).toHaveBeenCalledWith('openai');
  });

  it('Reveal toggles plaintext into the row, then masks again on close', async () => {
    const revealSpy = vi.fn(async () => 'sk-secret-key');
    useKeyVaultStore.setState({ reveal: revealSpy });
    render(<KeyVaultModal />);
    await waitFor(() => expect(screen.getAllByTestId('key-vault-row')).toHaveLength(5));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /reveal openai/i }));
    await waitFor(() => expect(screen.getByText('sk-secret-key')).toBeInTheDocument());
    // Close the modal and assert no plaintext remains rendered.
    useUiStore.getState().closeKeyVault();
    await waitFor(() => {
      expect(screen.queryByText('sk-secret-key')).toBeNull();
    });
  });

  it('renders error banner when store.error is set', async () => {
    useKeyVaultStore.setState({ error: 'fetch failed' });
    render(<KeyVaultModal />);
    expect(screen.getByText(/fetch failed/i)).toBeInTheDocument();
  });

  it('shows status dot from useProviderAuthStore for each vault row', async () => {
    useProviderAuthStore.setState({
      statuses: [
        { transport: 'anthropic', state: 'ok', reason: 'oauth' },
        { transport: 'openai', state: 'error', reason: '401', detail: 'unauthorized' },
        { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
        { transport: 'ollama', state: 'unconfigured', reason: 'no api key' },
      ],
      checkedAt: 1,
      loading: false,
      error: null,
    });
    render(<KeyVaultModal />);
    await waitFor(() => expect(screen.getAllByTestId('key-vault-row')).toHaveLength(5));
    const rows = screen.getAllByTestId('key-vault-row');
    // anthropic row has a green dot; openai has a red one. We assert by querying within rows.
    expect(rows[0].querySelector('[data-state="ok"]')).not.toBeNull();
    expect(rows[2].querySelector('[data-state="error"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/profiles/KeyVaultModal.test.tsx
```

- [ ] **Step 3: Implement** — `src/components/profiles/KeyVaultModal.tsx`

```tsx
import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { Modal } from '@/src/components/ui/Modal';
import { useUiStore } from '@/src/stores/ui.store';
import { useKeyVaultStore } from '@/src/stores/keyVault.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import type { VaultTransport, InfoTransport } from '@/src/types/key-vault.types';
import { cn } from '@/src/lib/cn';

const VAULT_ORDER: VaultTransport[] = ['anthropic', 'openai', 'gemini'];
const INFO_ORDER: InfoTransport[] = ['anthropic-oauth', 'ollama'];

const LABEL: Record<VaultTransport, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
};

const DOT_FOR_STATE: Record<'ok' | 'unconfigured' | 'error', string> = {
  ok: 'text-status-ok',
  unconfigured: 'text-zinc-500',
  error: 'text-status-error',
};

interface VaultRowProps {
  transport: VaultTransport;
  autoFocus: boolean;
}

function VaultRow({ transport, autoFocus }: VaultRowProps) {
  const row = useKeyVaultStore((s) => s.vault.find((r) => r.transport === transport));
  const save = useKeyVaultStore((s) => s.save);
  const clear = useKeyVaultStore((s) => s.clear);
  const reveal = useKeyVaultStore((s) => s.reveal);
  const status = useProviderAuthStore((s) =>
    s.statuses.find((x) => x.transport === transport),
  );

  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  // Auto-mask reveal after 10s
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(null), 10_000);
    return () => clearTimeout(t);
  }, [revealed]);

  // Confirm-clear timeout
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4_000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const onSave = async () => {
    if (!draft) return;
    await save(transport, draft);
    setDraft('');
  };

  const onClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await clear(transport);
    setConfirmClear(false);
  };

  const onReveal = async () => {
    if (revealed) {
      setRevealed(null);
      return;
    }
    const text = await reveal(transport);
    setRevealed(text);
  };

  const dotClass = status ? DOT_FOR_STATE[status.state] : 'text-zinc-600';

  return (
    <div
      data-testid="key-vault-row"
      className="flex items-center gap-2 p-2 rounded border border-border-subtle"
    >
      <span data-state={status?.state ?? 'unknown'} className={dotClass}>●</span>
      <span className="w-20 text-xs font-mono text-zinc-300">{LABEL[transport]}</span>
      {row?.hasKey ? (
        <>
          <span className="flex-1 font-mono text-xs text-zinc-400">
            {revealed ?? row.masked}
          </span>
          <button
            type="button"
            aria-label={`Reveal ${transport}`}
            onClick={onReveal}
            className="text-zinc-500 hover:text-white"
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            aria-label={`Clear ${transport}`}
            onClick={onClear}
            className={cn('text-xs px-2 py-1 rounded', confirmClear
              ? 'bg-status-error/20 text-status-error border border-status-error/40'
              : 'text-zinc-500 hover:text-white')}
          >
            {confirmClear ? 'Confirm clear?' : 'Clear'}
          </button>
        </>
      ) : (
        <>
          <input
            type="password"
            aria-label={`${LABEL[transport]} key`}
            autoFocus={autoFocus}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Enter ${LABEL[transport]} API key`}
            className="flex-1 px-2 py-1 bg-surface-3 border border-border-subtle rounded text-xs text-white"
          />
          <button
            type="button"
            aria-label={`Save ${transport}`}
            onClick={onSave}
            disabled={!draft}
            className="text-xs px-2 py-1 rounded bg-accent/20 text-accent border border-accent/40 disabled:opacity-40"
          >
            Save
          </button>
        </>
      )}
    </div>
  );
}

function InfoRow({ transport }: { transport: InfoTransport }) {
  const info = useKeyVaultStore((s) => s.info.find((r) => r.transport === transport));
  if (!info) return null;
  return (
    <div
      data-testid="key-vault-row"
      className="flex items-center gap-2 p-2 rounded border border-border-subtle bg-surface-2 text-xs text-zinc-400 font-mono"
    >
      <span className="w-20 text-zinc-300">{info.label}</span>
      <span className="flex-1">{info.status}</span>
    </div>
  );
}

export function KeyVaultModal() {
  const open = useUiStore((s) => s.keyVaultOpen);
  const close = useUiStore((s) => s.closeKeyVault);
  const focus = useUiStore((s) => s.keyVaultFocusTransport);
  const init = useKeyVaultStore((s) => s.init);
  const error = useKeyVaultStore((s) => s.error);

  useEffect(() => {
    if (open) void init();
  }, [open, init]);

  if (!open) return null;

  return (
    <Modal onClose={close}>
      <div className="w-[28rem] p-4 space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <KeyRound size={14} className="text-accent" />
          <div className="mono-label">Provider Keys</div>
        </div>
        {error && (
          <div className="p-1.5 rounded bg-status-error/10 border border-status-error/40 text-status-error text-[10px]">
            {error}
          </div>
        )}
        <VaultRow transport="anthropic" autoFocus={focus === 'anthropic'} />
        <InfoRow transport="anthropic-oauth" />
        <VaultRow transport="openai" autoFocus={focus === 'openai'} />
        <VaultRow transport="gemini" autoFocus={focus === 'gemini'} />
        <InfoRow transport="ollama" />
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run, expect GREEN**

```bash
npx vitest run src/components/profiles/KeyVaultModal.test.tsx
```

Expected: 7 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/profiles/KeyVaultModal.tsx src/components/profiles/KeyVaultModal.test.tsx
git commit -m "feat(slice-18): KeyVaultModal — 5 rows, save/clear/reveal/auto-mask/two-click confirm"
```

---

## Task M1: Click-to-open from ProviderAuthSection + mount in App

**Files:**
- Modify: `src/components/sidebar/ProviderAuthSection.tsx`
- Modify: `src/components/sidebar/ProviderAuthSection.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Append failing test** to `ProviderAuthSection.test.tsx`

```tsx
describe('ProviderAuthSection — click to open vault', () => {
  beforeEach(() => {
    useProviderAuthStore.getState()._reset();
    useUiStore.getState()._reset();
  });

  it('clicking an unconfigured row opens the key vault for that transport', async () => {
    useProviderAuthStore.setState({
      statuses: [
        { transport: 'anthropic', state: 'ok', reason: 'oauth' },
        { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
        { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
        { transport: 'ollama', state: 'ok', reason: '2 models' },
      ],
      checkedAt: 1,
      loading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<ProviderAuthSection />);
    const rows = screen.getAllByTestId('provider-auth-row');
    await user.click(rows[1]);
    expect(useUiStore.getState().keyVaultOpen).toBe(true);
    expect(useUiStore.getState().keyVaultFocusTransport).toBe('openai');
  });

  it('clicking an ok row does NOT open the vault', async () => {
    useProviderAuthStore.setState({
      statuses: [{ transport: 'anthropic', state: 'ok', reason: 'oauth' }],
      checkedAt: 1, loading: false, error: null,
    });
    const user = userEvent.setup();
    render(<ProviderAuthSection />);
    const rows = screen.getAllByTestId('provider-auth-row');
    await user.click(rows[0]);
    expect(useUiStore.getState().keyVaultOpen).toBe(false);
  });
});
```

Make sure `useUiStore` import exists in the file.

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/sidebar/ProviderAuthSection.test.tsx
```

- [ ] **Step 3: Modify `ProviderAuthSection.tsx`**

Add the import:

```tsx
import { useUiStore } from '@/src/stores/ui.store';
import type { VaultTransport } from '@/src/types/key-vault.types';
```

Replace the row-rendering JSX so that non-OK vault transports become clickable. Helper inside the component:

```tsx
const VAULT_TRANSPORTS_SET = new Set<VaultTransport>(['anthropic', 'openai', 'gemini']);
const openVault = useUiStore((s) => s.openKeyVault);

// inside the .map((t) => ...) for a status row:
const clickable = s.state !== 'ok' && VAULT_TRANSPORTS_SET.has(t as VaultTransport);
return (
  <div
    key={t}
    data-testid="provider-auth-row"
    title={s.detail ?? ''}
    onClick={clickable ? () => openVault(t as VaultTransport) : undefined}
    role={clickable ? 'button' : undefined}
    tabIndex={clickable ? 0 : undefined}
    className={cn(
      'flex items-center gap-2 px-1.5 py-1 rounded text-[10px] font-mono text-zinc-400',
      clickable && 'cursor-pointer hover:bg-surface-3',
    )}
  >
    {/* existing inner content */}
  </div>
);
```

- [ ] **Step 4: Run, expect GREEN**

```bash
npx vitest run src/components/sidebar/ProviderAuthSection.test.tsx
```

- [ ] **Step 5: Mount `<KeyVaultModal />` in App.tsx**

In `src/App.tsx`, add:

```tsx
import { KeyVaultModal } from '@/src/components/profiles/KeyVaultModal';
```

Add the mount near `<ProfilesModal />`:

```tsx
<ProfilesModal />
<KeyVaultModal />
<SubAgentEditModal />
```

- [ ] **Step 6: Run the FE suite to confirm no regressions**

```bash
npx vitest run src/
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/ProviderAuthSection.tsx src/components/sidebar/ProviderAuthSection.test.tsx src/App.tsx
git commit -m "feat(slice-18): ProviderAuthSection click-to-open + mount KeyVaultModal in App"
```

---

## Task N1: MSW defaults

**Files:**
- Modify: `src/test/msw-handlers.ts`

- [ ] **Step 1: Append handlers**

Append to the `handlers` array:

```ts
http.get('http://localhost/api/providers/keys', () =>
  HttpResponse.json({
    vault: [
      { transport: 'anthropic', hasKey: false, masked: null, updatedAt: null },
      { transport: 'openai', hasKey: false, masked: null, updatedAt: null },
      { transport: 'gemini', hasKey: false, masked: null, updatedAt: null },
    ],
    info: [
      { transport: 'anthropic-oauth', label: 'Anthropic OAuth (via claude CLI)', status: 'detected' },
      { transport: 'ollama', label: 'Ollama', status: 'Host: http://localhost:11434' },
    ],
  }),
),
http.put('http://localhost/api/providers/keys/:transport', async ({ params, request }) => {
  const body = (await request.json()) as { key: string };
  return HttpResponse.json({
    row: {
      transport: params.transport,
      hasKey: true,
      masked: `${body.key.slice(0, 3)}…${body.key.slice(-4)}`,
      updatedAt: Date.now(),
    },
    status: { transport: params.transport, state: 'ok', reason: 'api key set' },
  });
}),
http.delete('http://localhost/api/providers/keys/:transport', ({ params }) =>
  HttpResponse.json({
    status: { transport: params.transport, state: 'unconfigured', reason: 'no api key' },
  }),
),
http.get('http://localhost/api/providers/keys/:transport', ({ params }) =>
  HttpResponse.json({ plaintext: `mock-${params.transport}-key` }),
),
```

- [ ] **Step 2: Run the FE suite**

```bash
npx vitest run src/
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/test/msw-handlers.ts
git commit -m "test(slice-18): MSW defaults for key vault endpoints"
```

---

## Task O1: Integration test

**Files:**
- Create: `src/integration/key-vault.integration.test.tsx`

- [ ] **Step 1: Write the test**

`src/integration/key-vault.integration.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useChatStore } from '@/src/stores/chat.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { useKeyVaultStore } from '@/src/stores/keyVault.store';
import { __setIsMacForTests } from '@/src/hooks/useKeyboardShortcut';

beforeEach(() => {
  __setIsMacForTests(true);
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  useChatStore.getState()._reset();
  useProviderAuthStore.getState()._reset();
  useKeyVaultStore.getState()._reset();
  localStorage.clear();
});

afterEach(() => {
  __setIsMacForTests(null);
  server.resetHandlers();
});

describe('key vault integration', () => {
  it('Cmd+K → Configure API keys… → save OpenAI → row shows masked + dot turns ok', async () => {
    let putCalled = false;
    server.use(
      http.put('http://localhost/api/providers/keys/openai', async ({ request }) => {
        putCalled = true;
        const body = (await request.json()) as { key: string };
        expect(body.key).toBe('sk-int-test-12345');
        return HttpResponse.json({
          row: { transport: 'openai', hasKey: true, masked: 'sk-…2345', updatedAt: 1 },
          status: { transport: 'openai', state: 'ok', reason: 'api key set' },
        });
      }),
    );

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useSessionsStore.getState().hydrated).toBe(true));

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }),
      );
    });
    await waitFor(() => expect(useUiStore.getState().paletteOpen).toBe(true));

    await user.click(screen.getByText('Configure API keys…'));

    await waitFor(() => expect(useUiStore.getState().keyVaultOpen).toBe(true));
    await waitFor(() => expect(screen.getAllByTestId('key-vault-row').length).toBe(5));

    const input = screen.getByLabelText(/openai key/i) as HTMLInputElement;
    await user.type(input, 'sk-int-test-12345');
    await user.click(screen.getByRole('button', { name: /save openai/i }));

    await waitFor(() => expect(putCalled).toBe(true));
    await waitFor(() => {
      const row = useKeyVaultStore.getState().vault.find((r) => r.transport === 'openai')!;
      expect(row.hasKey).toBe(true);
      expect(row.masked).toBe('sk-…2345');
    });
  });
});
```

- [ ] **Step 2: Run, expect GREEN**

```bash
npx vitest run src/integration/key-vault.integration.test.tsx
```

Expected: 1 case passes. If it fails, diagnose (likely cause: palette command not yet visible — check `useCommands.ts` from Task K1).

- [ ] **Step 3: Commit**

```bash
git add src/integration/key-vault.integration.test.tsx
git commit -m "test(slice-18): integration — palette → vault modal → save OpenAI key"
```

---

## Task P1: Playwright smoke + final gates + PR

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Append a smoke test**

```ts
test('key vault: open modal via palette, save a key, reopen shows masked', async ({ page }) => {
  await page.goto('/');
  await page.getByText('AETHER_CORE').waitFor();

  // Open palette + run Configure API keys
  await page.keyboard.press('Meta+K');
  await page.getByText('Configure API keys…').click();

  // 5 rows are visible
  await expect(page.getByTestId('key-vault-row')).toHaveCount(5);

  // Type and save an OpenAI key
  const openaiInput = page.getByLabel('OpenAI key');
  await openaiInput.fill('sk-e2e-test-key-67890');
  await page.getByRole('button', { name: /save openai/i }).click();

  // The row updates to the masked form
  await expect(page.getByText('sk-…7890')).toBeVisible({ timeout: 3000 });

  // Two-click clear
  await page.getByRole('button', { name: /clear openai/i }).click();
  await page.getByRole('button', { name: /confirm clear/i }).click();
  await expect(page.getByLabel('OpenAI key')).toBeVisible();
});
```

- [ ] **Step 2: Build + playwright**

```bash
npm run build
npx playwright test
```

Expected: all pass (16 tests including the new one).

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 4: Full vitest**

```bash
npx vitest run
```

Expected: all green except the 2 pre-existing Ollama flakes.

- [ ] **Step 5: Commit smoke + push**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(slice-18): playwright smoke for key vault modal"
git push -u origin feat/slice-18-key-vault
```

- [ ] **Step 6: Open the PR**

```bash
gh pr create --title "feat(slice-18): in-app provider key vault" --body "$(cat <<'EOF'
## Summary
- New `KeyVaultService` encrypts API keys with AES-256-GCM; key derived from `os.hostname()` + `os.userInfo().username` via scrypt. Stored in `provider_keys` (migration 003).
- New `KeyResolver` exposes env-wins-over-vault resolution. `ProviderRegistry` and `AuthStatusService` refactored to consult the resolver on every `refresh()` / `probe()` — no more constructor-time capture.
- 4 new routes under `/api/providers/keys` (list, reveal, set, clear). Each mutation runs `providers.refresh()` + `authStatusService.probe([transport])` and, for Anthropic, updates `process.env.ANTHROPIC_API_KEY`.
- New `KeyVaultModal` opened from the palette (`Configure API keys…`) or by clicking a non-OK row in `ProviderAuthSection`. 5 rows: 3 editable + 2 read-only info. Per-row status dot bound to `useProviderAuthStore`. Reveal toggle auto-masks after 10 s. Clear is two-click inline confirm.

## Test plan
- [x] `key-crypto` unit tests (7 cases)
- [x] `KeyVaultService` unit tests (11 cases)
- [x] `KeyResolver` unit tests (6 cases)
- [x] Registry + AuthStatusService refactors (existing tests pass with new callback signatures)
- [x] 4 new routes (9 cases incl. 503 fallback)
- [x] FE api (4 cases) + store (6 cases) + UI store + palette command
- [x] `KeyVaultModal` (7 cases)
- [x] ProviderAuthSection click-to-open
- [x] MSW defaults
- [x] Integration test: palette → vault → save OpenAI → masked row
- [x] Playwright smoke: full round-trip
- [x] Lint clean, full vitest green modulo pre-existing Ollama flakes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-review

| Spec requirement | Task |
|---|---|
| Migration 003 with `provider_keys` table | B1 |
| AES-256-GCM + scrypt machine-derived key | B1 |
| Tamper detection on decrypt | B1 |
| `KeyVaultService` set/get/clear/listMasked | C1 |
| `buildInfoRows` for anthropic-oauth + ollama | C1 |
| Mask format (last 4 chars) | C1 (`mask` helper) |
| Corrupted ciphertext → row reports `hasKey:false` | C1 |
| `KeyResolver` env-wins precedence | D1 |
| Registry uses callbacks (no constructor capture) | E1 |
| AuthStatusService uses callbacks | F1 |
| GET /keys (list) | G1 |
| GET /keys/:t?reveal=1 | G1 |
| PUT /keys/:t with refresh + probe | G1 |
| DELETE /keys/:t with refresh + probe | G1 |
| 503 when keyVault absent | G1 |
| Anthropic env-var side effect | G1 (route hook) + H1 (bootstrap priming) |
| Bootstrap wiring | H1 |
| FE api | I1 |
| FE store with cross-store refresh + dedupe | J1 |
| ui.store + palette command | K1 |
| 5-row modal w/ reveal auto-mask, two-click clear, status dots | L1 |
| Click-to-open from auth pane | M1 |
| Mount in App | M1 |
| MSW defaults | N1 |
| Integration | O1 |
| Playwright + final gates + PR | P1 |

No placeholders. No "TODO". Method names consistent: `setKey/getKey/clearKey/listMasked/buildInfoRows/reveal/save/clear`. Component testid `key-vault-row` used consistently.
