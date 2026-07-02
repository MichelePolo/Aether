# Code-review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate all 21 findings from the 2026-07-02 full-project code review, grouped into 5 phases by fix character.

**Architecture:** Backend is Express + better-sqlite3 in a single Node process; frontend is React 19 + Zustand. Fixes are surgical — no restructuring beyond what each fix needs. Each task is TDD (failing test first) and ends with a commit. Phases are ordered so the suite stays green after every task.

**Tech Stack:** TypeScript (strict, `noEmit`), Vitest (two projects: `backend` node, `frontend` jsdom, globals on — no need to import describe/it/expect), Express, better-sqlite3, Node crypto.

**Spec:** `docs/superpowers/specs/2026-07-02-code-review-fixes-design.md`

## Global Constraints

- `npm run lint` (`tsc --noEmit`) MUST stay green after every task — it is the only lint step.
- Migrations are append-only; never edit an existing `server/db/migrations/*.sql`. (No new migration is needed in this plan — C2 is fixed in app code because SQLite cannot `ALTER TABLE ADD CONSTRAINT`.)
- `@/*` imports are written from the repo root, e.g. `@/server/...`, `@/src/...`.
- Tests are colocated as `*.test.ts(x)` next to source.
- Cross-platform: no assumptions about path separators, case-sensitivity, or POSIX-only APIs (user runs Windows/macOS/Linux).
- Commit messages end with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Work on a branch `fix/code-review-remediation` (do not commit these fixes to `feat/pages-site`; branch first).

---

## Phase A — Security

### Task A1: Loopback-by-default bind + `AETHER_HOST` opt-in + loopback-only key reveal (S1)

**Files:**
- Modify: `server/index.ts:313-314` (host computation), `server/index.ts:316-326` (bind log)
- Modify: `server/routes/providers.routes.ts:180-201` (reveal endpoint) + a small loopback helper
- Create: `server/lib/net.ts` (loopback helper), `server/lib/net.test.ts`

**Interfaces:**
- Produces: `isLoopbackAddress(addr: string | undefined): boolean` in `server/lib/net.ts`.

- [ ] **Step 1: Write the failing test** — `server/lib/net.test.ts`

```ts
import { isLoopbackAddress } from '@/server/lib/net';

describe('isLoopbackAddress', () => {
  it('accepts IPv4 and IPv6 loopback', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
  });
  it('rejects LAN and undefined', () => {
    expect(isLoopbackAddress('192.168.1.20')).toBe(false);
    expect(isLoopbackAddress('10.0.0.5')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run server/lib/net.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `server/lib/net.ts`

```ts
/** True for IPv4/IPv6 loopback, including IPv4-mapped IPv6 (`::ffff:127.x`). */
export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  if (a === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run server/lib/net.test.ts` → PASS.

- [ ] **Step 5: Change the bind host** — `server/index.ts`, replace lines 313-314:

```ts
  const isDaemon = process.env.AETHER_DAEMON === '1';
  // Default to loopback for BOTH daemon and non-daemon. Opting into LAN
  // exposure is deliberate via AETHER_HOST (e.g. '0.0.0.0'). See spec D1.
  const host = process.env.AETHER_HOST ?? '127.0.0.1';
```

And in the `app.listen` callback (after the existing `console.log`), add a warning when non-loopback:

```ts
    if (!isLoopbackAddress(host) && host !== '127.0.0.1') {
      console.warn(
        `[aether] WARNING: API bound to ${host} — reachable on the network. ` +
          `Anyone on your LAN can drive dispatch and tools. Unset AETHER_HOST for loopback-only.`,
      );
    }
```

Add `import { isLoopbackAddress } from '@/server/lib/net';` at the top of `server/index.ts`.

- [ ] **Step 6: Guard the reveal endpoint** — `server/routes/providers.routes.ts`, inside the `/keys/:transport` GET handler, immediately after the `if (!keyVault)` block and before reading `transport`, add:

```ts
      if (!isLoopbackAddress(req.socket.remoteAddress ?? undefined)) {
        res.status(403).json({
          error: { code: 'LOOPBACK_ONLY', message: 'Key reveal is restricted to localhost' },
        });
        return;
      }
```

Add `import { isLoopbackAddress } from '@/server/lib/net';` at the top of `providers.routes.ts`.

- [ ] **Step 7: Write a route test** — in the existing `server/routes/providers.routes.test.ts` (or create it) assert that a request whose `req.socket.remoteAddress` is a LAN IP gets 403 from `GET /api/providers/keys/anthropic?reveal=1`, and a loopback request does not. Use the project's existing supertest/app-builder pattern (supertest connects over `127.0.0.1`, so the positive path is the default; simulate LAN by wrapping the router in an app whose middleware overrides `req.socket.remoteAddress = '10.0.0.5'` before the router).

```ts
it('refuses key reveal from a non-loopback peer', async () => {
  const app = express();
  app.use((req, _res, next) => { Object.defineProperty(req.socket, 'remoteAddress', { value: '10.0.0.5', configurable: true }); next(); });
  app.use('/api/providers', createProviderRoutes(depsWithVault));
  const res = await request(app).get('/api/providers/keys/anthropic?reveal=1');
  expect(res.status).toBe(403);
});
```

- [ ] **Step 8: Verify** — `npx vitest run --project backend server/routes/providers.routes.test.ts server/lib/net.test.ts` → PASS; `npm run lint` → clean.

- [ ] **Step 9: Commit**

```bash
git add server/lib/net.ts server/lib/net.test.ts server/index.ts server/routes/providers.routes.ts server/routes/providers.routes.test.ts
git commit -m "fix(security): bind loopback by default (AETHER_HOST opt-in), restrict key reveal to localhost"
```

### Task A2: Random per-install vault key + boot migration (S2)

**Files:**
- Modify: `server/lib/key-crypto.ts` (whole file)
- Create: `server/lib/vault-migrate.ts`, `server/lib/vault-migrate.test.ts`, `server/lib/key-crypto.test.ts`
- Modify: `server/index.ts` bootstrap (call migration after DB migrations, before building services that read keys)

**Interfaces:**
- Produces: `loadOrCreateVaultKey(dataDir: string): Buffer`, `encrypt(plaintext, key): EncryptedBlob`, `decrypt(blob, key): string`, `deriveLegacyKey(): Buffer`, `resetKeyCache(): void` (test seam) in `key-crypto.ts`.
- Produces: `migrateVaultToRandomKey(db: DatabaseHandle, dataDir: string): void` in `vault-migrate.ts`.

- [ ] **Step 1: Write the failing test** — `server/lib/key-crypto.test.ts`

```ts
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { loadOrCreateVaultKey, encrypt, decrypt, resetKeyCache } from '@/server/lib/key-crypto';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'aether-vault-')); }

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
    } finally { delete process.env.AETHER_VAULT_KEY; resetKeyCache(); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run server/lib/key-crypto.test.ts` → FAIL (new API not present).

- [ ] **Step 3: Rewrite `server/lib/key-crypto.ts`**

```ts
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LEGACY_SALT = Buffer.from('aether-key-vault-salt-v1', 'utf-8');
const KEY_LEN = 32; // AES-256
const IV_LEN = 12;  // GCM standard
const KEY_FILE = '.vault.key';

export interface EncryptedBlob { ciphertext: Buffer; iv: Buffer; authTag: Buffer; }

let cachedKey: Buffer | null = null;

/** Test seam: forget the in-module cached key. */
export function resetKeyCache(): void { cachedKey = null; }

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
    if (buf.length !== KEY_LEN) throw new Error('AETHER_VAULT_KEY must be 64 hex chars (32 bytes)');
    cachedKey = buf;
    return cachedKey;
  }
  const file = path.join(dataDir, KEY_FILE);
  if (fs.existsSync(file)) {
    cachedKey = fs.readFileSync(file);
    if (cachedKey.length !== KEY_LEN) throw new Error(`corrupt vault key file: ${file}`);
    return cachedKey;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(KEY_LEN);
  fs.writeFileSync(file, key, { mode: 0o600 });
  cachedKey = key;
  return key;
}

/** Legacy hostname-derived key — kept ONLY for one-time migration. */
export function deriveLegacyKey(): Buffer {
  const seed = `${os.hostname()}|${os.userInfo().username}`;
  return scryptSync(seed, LEGACY_SALT, KEY_LEN, { N: 16384, r: 8, p: 1 });
}

export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, blob.iv);
  decipher.setAuthTag(blob.authTag);
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]).toString('utf-8');
}
```

- [ ] **Step 4: Update the 3 secret stores to take/hold the active key.** `encrypt`/`decrypt` now require a key argument. The stores are `server/domain/providers/key-vault.ts`, `ollama-endpoints.store.ts`, `openai-endpoints.store.ts`. Give each a constructor that receives the key (thread from bootstrap), and pass it to `encrypt`/`decrypt`. Example for `key-vault.ts`:

```ts
export class KeyVaultService {
  constructor(private readonly db: DatabaseHandle, private readonly key: Buffer) {}
  // setKey: const blob = encrypt(plaintext, this.key);
  // getKey: return decrypt({ ciphertext, iv, authTag }, this.key);
}
```

Update their construction sites in `server/index.ts` bootstrap to pass `vaultKey` (see Step 6). Update any existing store tests to pass a test key `Buffer.alloc(32, 1)`.

- [ ] **Step 5: Write the migration test** — `server/lib/vault-migrate.test.ts`

```ts
import { migrateVaultToRandomKey } from '@/server/lib/vault-migrate';
import { encrypt, decrypt, deriveLegacyKey, loadOrCreateVaultKey, resetKeyCache } from '@/server/lib/key-crypto';
// ...open an in-memory/temp DB with the provider_keys schema (reuse the project's test DB helper)...

it('re-encrypts legacy-keyed rows under the active key', () => {
  resetKeyCache();
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

it('is idempotent for rows already under the active key', () => {
  resetKeyCache();
  const dir = tmpDir();
  const active = loadOrCreateVaultKey(dir);
  const blob = encrypt('sk-new', active);
  db.prepare('INSERT INTO provider_keys (transport, ciphertext, iv, auth_tag, updated_at) VALUES (?,?,?,?,?)')
    .run('openai', blob.ciphertext, blob.iv, blob.authTag, Date.now());
  expect(() => migrateVaultToRandomKey(db, dir)).not.toThrow();
  const row = db.prepare('SELECT ciphertext, iv, auth_tag FROM provider_keys WHERE transport = ?').get('openai') as any;
  expect(decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, active)).toBe('sk-new');
});
```

- [ ] **Step 6: Implement `server/lib/vault-migrate.ts`**

```ts
import type { DatabaseHandle } from '@/server/db/database';
import { loadOrCreateVaultKey, deriveLegacyKey, encrypt, decrypt, type EncryptedBlob } from '@/server/lib/key-crypto';

interface SecretRow { rowid: number; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; }

const TABLES = ['provider_keys', 'ollama_endpoints', 'openai_endpoints'] as const;

/** One-time, idempotent re-encryption of all vault secrets under the active key. */
export function migrateVaultToRandomKey(db: DatabaseHandle, dataDir: string): void {
  const active = loadOrCreateVaultKey(dataDir);
  const legacy = deriveLegacyKey();
  const run = db.transaction(() => {
    for (const table of TABLES) {
      // Skip tables that don't exist yet (migrations may predate them).
      const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
      if (!exists) continue;
      const rows = db.prepare(`SELECT rowid, ciphertext, iv, auth_tag FROM ${table}`).all() as SecretRow[];
      for (const r of rows) {
        const blob: EncryptedBlob = { ciphertext: r.ciphertext, iv: r.iv, authTag: r.auth_tag };
        try { decrypt(blob, active); continue; } catch { /* not active-key; try legacy */ }
        let plaintext: string;
        try { plaintext = decrypt(blob, legacy); } catch { continue; /* unknown key: leave as-is */ }
        const re = encrypt(plaintext, active);
        db.prepare(`UPDATE ${table} SET ciphertext=?, iv=?, auth_tag=? WHERE rowid=?`)
          .run(re.ciphertext, re.iv, re.authTag, r.rowid);
      }
    }
  });
  run();
}
```

(If `ollama_endpoints`/`openai_endpoints` use different column names for the blob, adjust the SELECT/UPDATE column lists per that table's schema — read the schema first with `.prepare("SELECT sql FROM sqlite_master WHERE name=?")`.)

- [ ] **Step 7: Wire into bootstrap** — `server/index.ts`, after migrations run and `cfg.dataDir` is known, before constructing the key-reading services:

```ts
  const vaultKey = loadOrCreateVaultKey(cfg.dataDir);
  migrateVaultToRandomKey(db, cfg.dataDir);
```

Pass `vaultKey` to `new KeyVaultService(db, vaultKey)`, the ollama- and openai-endpoint stores. Add the imports.

- [ ] **Step 8: Verify** — `npx vitest run --project backend server/lib/key-crypto.test.ts server/lib/vault-migrate.test.ts` and the updated store tests → PASS; `npm run lint` → clean.

- [ ] **Step 9: Commit**

```bash
git add server/lib/key-crypto.ts server/lib/key-crypto.test.ts server/lib/vault-migrate.ts server/lib/vault-migrate.test.ts server/domain/providers/*.ts server/index.ts
git commit -m "fix(security): random per-install vault key + boot migration; fixes cross-machine key loss"
```

### Task A3: Gemini auth probe uses header, not URL (S3)

**Files:** Modify `server/domain/providers/auth-status.ts:102-105`

- [ ] **Step 1: Write the failing test** — in `server/domain/providers/auth-status.test.ts`, stub `fetchWithTimeout` (or `global.fetch`) and assert the Gemini probe URL has **no** `key=` query param and that the request carries an `x-goog-api-key` header equal to the key.

```ts
it('sends the Gemini key as a header, never in the URL', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const svc = makeAuthStatus({ getGeminiKey: () => 'gem-secret', fetch: (url, init) => { calls.push({ url: String(url), init }); return Promise.resolve(new Response('{}', { status: 200 })); } });
  await svc.probeGeminiForTest(); // expose via a thin test hook or call the public probe
  expect(calls[0].url).not.toContain('key=');
  expect((calls[0].init?.headers as Record<string,string>)['x-goog-api-key']).toBe('gem-secret');
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run server/domain/providers/auth-status.test.ts` → FAIL (key still in URL).

- [ ] **Step 3: Implement** — replace lines 102-105:

```ts
    const url = 'https://generativelanguage.googleapis.com/v1beta/models';
    const res = await this.fetchWithTimeout(url, { headers: { 'x-goog-api-key': apiKey } });
```

Ensure `fetchWithTimeout` forwards an optional `init` (add a second param if missing) and that no code path interpolates the key into a URL or error string.

- [ ] **Step 4: Verify** — test PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/domain/providers/auth-status.ts server/domain/providers/auth-status.test.ts
git commit -m "fix(security): send Gemini auth-probe key via x-goog-api-key header, not URL"
```

---

## Phase B — Crash & leak safety

### Task B1: MCP child stdin `'error'` listener (R1)

**Files:** Modify `server/domain/mcp/stdio-connection.ts` (after spawn, ~line 44-52)

- [ ] **Step 1: Write the failing test** — `stdio-connection.test.ts`: spawn a connection against a child that exits immediately (e.g. `node -e "process.exit(0)"`), then call `notify()`/write after exit and assert the process does not emit an unhandled error (the test itself passing without a thrown top-level error is the assertion; add a listener on `process` for `uncaughtException` within the test and assert it is not called).

```ts
it('does not crash when writing to a dead child stdin', async () => {
  const conn = new StdioMcpConnection({ command: process.execPath, args: ['-e', 'process.exit(0)'], env: {} });
  await conn.initialize().catch(() => {});
  await new Promise((r) => setTimeout(r, 50));
  expect(() => (conn as any).notify('notifications/ping')).not.toThrow();
  // and no async 'error' bubbles: give the event loop a tick
  await new Promise((r) => setTimeout(r, 20));
});
```

- [ ] **Step 2: Run test** → FAIL or flaky-crash before the fix.

- [ ] **Step 3: Implement** — after `this.proc = spawn(...)` and the existing `this.proc.on('error', ...)`, add:

```ts
    // A write to a child whose stdin has closed emits an ASYNC 'error' on the
    // stream; with no listener Node escalates it to an unhandled process error
    // and crashes the whole server. Swallow it — 'exit' already fails pending.
    this.proc.stdin.on('error', () => { /* pipe closed; handled via 'exit' */ });
```

- [ ] **Step 4: Verify** → PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/stdio-connection.ts server/domain/mcp/stdio-connection.test.ts
git commit -m "fix(mcp): attach stdin 'error' listener so a dead child pipe can't crash the server"
```

### Task B2: SSE emitter learns about disconnects (R2)

**Files:** Modify `server/lib/sse.ts`, `server/routes/dispatch.routes.ts`

**Interfaces:** Produces `SseEmitter.markClosed(): void`.

- [ ] **Step 1: Write the failing test** — `server/lib/sse.test.ts`: build an emitter over a fake `Response` whose `write` throws (simulating a destroyed socket) after `markClosed()`; assert `event()` after `markClosed()` does not call `write` and does not throw.

```ts
it('stops writing after markClosed()', () => {
  let writes = 0;
  const res = { setHeader() {}, write() { writes++; return true; }, end() {}, writableEnded: false } as any;
  const sse = createSseEmitter(res);
  sse.event('text', { chunk: 'a' });
  sse.markClosed();
  sse.event('text', { chunk: 'b' });
  expect(writes).toBe(1); // only the pre-close write
});
```

- [ ] **Step 2: Run test** → FAIL (`markClosed` not a function).

- [ ] **Step 3: Implement** — in `sse.ts`, add to the `SseEmitter` interface `markClosed(): void;` and to the returned object:

```ts
    markClosed() { closed = true; },
```

- [ ] **Step 4: Wire the routes** — in `dispatch.routes.ts`, in BOTH handlers (`/` and `/resume`) replace the `res.on('close')` block with:

```ts
    res.on('error', () => {}); // a write-after-close must never escalate to a process error
    res.on('close', () => {
      sse.markClosed();
      if (!res.writableEnded) controller.abort();
    });
```

- [ ] **Step 5: Verify** — `npx vitest run --project backend server/lib/sse.test.ts` → PASS; run the existing dispatch route tests → still green; `npm run lint` clean.

- [ ] **Step 6: Commit**

```bash
git add server/lib/sse.ts server/lib/sse.test.ts server/routes/dispatch.routes.ts
git commit -m "fix(sse): mark emitter closed + swallow response errors on client disconnect"
```

### Task B3: Don't execute a tool call after the client aborts (R3)

**Files:** Modify `server/domain/dispatch/dispatch.service.ts` (~line 354-368, and the Anthropic in-process tool path)

- [ ] **Step 1: Write the failing test** — in `dispatch.service.test.ts`, drive a dispatch with a fake provider that yields a `function_call` chunk, but abort the signal before the tool executes; assert the tool executor (spy on `gateExecuteAndTrace`/the MCP registry `callTool`) is **not** invoked and the turn is persisted with `interrupted: true`.

```ts
it('does not execute a tool call once the signal is aborted', async () => {
  const executed = vi.fn();
  // fake provider yields one function_call chunk; controller.abort() fired right after
  // wire executed as the tool executor spy; drive handle() with the aborted signal
  await dispatcher.handle(body, sse, abortedAfterFunctionCallSignal);
  expect(executed).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test** → FAIL (tool executes despite abort).

- [ ] **Step 3: Implement** — in `runDispatchLoop`, immediately after `if (!pendingCall) break;` (line 354) add:

```ts
            if (signal.aborted) break; // client left after the function_call chunk; do not run the tool
```

Locate the Anthropic in-process tool-execution path (where the provider surfaces tool calls internally) and add the same `if (signal.aborted) break;` guard before it executes a tool.

- [ ] **Step 4: Verify** → PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "fix(dispatch): re-check abort before executing a tool call (client-disconnect safety)"
```

### Task B4: Abort the http-MCP SSE reader on timeout/close (R4)

**Files:** Modify `server/domain/mcp/http-connection.ts` (`openSseStream`, `close`, per-call timeout)

- [ ] **Step 1: Write the failing test** — `http-connection.test.ts`: point the connection at a local `http.Server` that opens an SSE stream and never ends it; issue a call with a short timeout; after the timeout rejects, assert the server observes the request being aborted (track `req.on('aborted')` / `res.on('close')` on the server side within the test).

- [ ] **Step 2: Run test** → FAIL (stream stays open after timeout).

- [ ] **Step 3: Implement** — give each RPC an `AbortController`; pass its `signal` to `fetch`. Keep the controller on the pending-entry so `close()`, the timeout handler, and external abort can call `controller.abort()`. In the read loop, also call `reader.cancel()` when `closeRequested` becomes true. Concretely: store `{ resolve, reject, controller }` in `this.pending`; in `cleanupPending(id)` call `entry.controller.abort()`; in the timeout `setTimeout` handler call `entry.controller.abort()` before rejecting; in `close()` (already iterates pending ids) the `cleanupPending` call now aborts each fetch.

- [ ] **Step 4: Verify** → PASS; run existing MCP tests → green; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/http-connection.ts server/domain/mcp/http-connection.test.ts
git commit -m "fix(mcp): abort the http SSE fetch/reader on timeout and close (socket leak)"
```

### Task B5: Close the spawned child when MCP connect fails (R5)

**Files:** Modify `server/domain/mcp/registry.ts` (connect path ~72-98, reconnect ~350-372, ~429-450)

- [ ] **Step 1: Write the failing test** — `registry.test.ts`: make `makeConnection` return a connection whose `initialize()` rejects; spy on that connection's `close`; call the connect method and assert `close` was awaited (i.e. the spawned child is cleaned up) even though connect rejects.

- [ ] **Step 2: Run test** → FAIL (`close` not called).

- [ ] **Step 3: Implement** — hoist `connection` above the `try` so it is reachable in `catch`; in each `catch` block, before recording error state / rethrowing, `await connection?.close().catch(() => {});`. Apply to all three sites (initial connect, `reconnectLoop`, `immediateReconnectAttempt`).

```ts
    let connection: McpConnection | undefined;
    try {
      connection = this.makeConnection(cfg);
      await connection.initialize();
      const tools = await connection.listTools();
      // ...
    } catch (e) {
      await connection?.close().catch(() => {});
      this.states.set(id, { state: 'error', error: e instanceof Error ? e.message : 'connect failed' });
      throw e;
    }
```

- [ ] **Step 4: Verify** → PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/registry.ts server/domain/mcp/registry.test.ts
git commit -m "fix(mcp): close spawned child when initialize/listTools fails (zombie-process leak)"
```

---

## Phase C — Async correctness

### Task C1: Shared SSE-run helper; fix swarm/tdd stuck-forever (C1)

**Files:**
- Create: `src/lib/run-sse.ts`, `src/lib/run-sse.test.ts`
- Modify: `src/hooks/useSwarmRun.ts`, `src/hooks/useTddRun.ts`

**Interfaces:** Produces `consumeRun(res: Response, onEvent: (name: string, data: unknown) => void): Promise<void>` and `class HttpError extends Error { status: number }`.

- [ ] **Step 1: Write the failing test** — `src/lib/run-sse.test.ts`

```ts
import { consumeRun, HttpError } from '@/src/lib/run-sse';

it('throws HttpError on non-2xx', async () => {
  const res = new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 });
  await expect(consumeRun(res, () => {})).rejects.toMatchObject({ name: 'HttpError', status: 400 });
});

it('emits parsed events for a 200 stream', async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: x\ndata: {"a":1}\n\n')); c.close(); } });
  const res = new Response(body, { status: 200 });
  const seen: string[] = [];
  await consumeRun(res, (name) => seen.push(name));
  expect(seen).toEqual(['x']);
});
```

- [ ] **Step 2: Run test** → FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/run-sse.ts`**

```ts
import { parseSseStream } from '@/src/lib/sse-parser';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'HttpError'; }
}

export async function consumeRun(res: Response, onEvent: (name: string, data: unknown) => void): Promise<void> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const j = await res.json(); message = (j?.error?.message as string) ?? message; } catch { /* non-JSON body */ }
    throw new HttpError(res.status, message);
  }
  if (!res.body) throw new Error('no stream');
  for await (const ev of parseSseStream(res.body)) onEvent(ev.event, ev.data);
}
```

- [ ] **Step 4: Rewrite `useSwarmRun.run`** (lines 60-79) using the helper, with a `finally` that guarantees the terminal reset and a catch that distinguishes abort:

```ts
  const run = useCallback(async (swarmId: string, input: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...INITIAL, running: true });
    try {
      const res = await fetch(`/api/swarms/${swarmId}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }), signal: controller.signal,
      });
      await consumeRun(res, (name, data) => setState((s) => reduce(s, name, data as any)));
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') { /* user cancelled */ }
      else setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Network error' }));
    } finally {
      setState((s) => (s.running ? { ...s, running: false } : s)); // reset even if stream ended without swarm_done
    }
  }, []);
```

Add `import { consumeRun } from '@/src/lib/run-sse';`.

- [ ] **Step 5: Rewrite `useTddRun.run`** (lines 52-74) the same way — replace the inline `if (!res.body)` + bare loop with `await consumeRun(res, (name, data) => setState((s) => reduceTdd(s, name, data as any)));` inside the existing `try`, and add the `finally` terminal reset:

```ts
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError'))
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Network error' }));
    } finally {
      setState((s) => (s.running ? { ...s, running: false } : s));
    }
```

- [ ] **Step 6: Write a hook regression test** — `src/hooks/useSwarmRun.test.tsx`: mock `fetch` to resolve 500; render the hook (`@testing-library/react` `renderHook`), call `run`, and assert `state.running` becomes `false` and `state.error` is set (not stuck true).

- [ ] **Step 7: Verify** — `npx vitest run --project frontend src/lib/run-sse.test.ts src/hooks/useSwarmRun.test.tsx` → PASS; `npm run lint` clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/run-sse.ts src/lib/run-sse.test.ts src/hooks/useSwarmRun.ts src/hooks/useTddRun.ts src/hooks/useSwarmRun.test.tsx
git commit -m "fix(swarm/tdd): shared consumeRun helper — check res.ok, always reset running (no more stuck UI)"
```

### Task C2: Cancel-during-fetch persists as interrupted; resume works (C3)

**Files:** Modify `server/domain/dispatch/dispatch.service.ts` (error branches in `handle()` ~594-609 and `resume()` ~783-798, plus a small `isAbort` helper near `classifyError`)

- [ ] **Step 1: Write the failing test** — `dispatch.service.test.ts`: fake provider whose `stream()` throws `AbortError` from its opening `fetch` (before any chunk); drive `handle()` with a signal that is aborted; assert the persisted model message has `interrupted === true` (not a plain error), and that a subsequent `resume()` for that message is accepted (does not emit "Message is not interrupted").

- [ ] **Step 2: Run test** → FAIL (`interrupted` falsy → resume refused).

- [ ] **Step 3: Implement** — add near `classifyError`:

```ts
function isAbort(e: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (e instanceof Error && e.name === 'AbortError');
}
```

In the `catch` of `runDispatchLoop`/`handle()` (around line 390 and the persistence branch ~594-609): when `isAbort(e, signal)` is true, persist the turn on the **interrupted path** (same shape as the graceful `interrupted: signal.aborted` success branch at ~636-649) instead of the `error` path — i.e. set `interrupted: true`, do not set `error`. Apply the identical change to `resume()`'s error branch (~783-798).

- [ ] **Step 4: Verify** → PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "fix(dispatch): treat cancel-during-fetch as interrupted so resume() works"
```

### Task C3: Freshness guards in the git stores (C4)

**Files:** Modify `src/stores/git.store.ts` (`load`), `src/stores/gitChanges.store.ts` (`load`, `refresh`)

- [ ] **Step 1: Write the failing test** — `src/stores/git.store.test.ts`: mock `gitApi.status`/`gitApi.log` so a call for workspace `A` resolves *after* a call for workspace `B`; invoke `load('A')` then `load('B')`, resolve A last, and assert the store ends with B's data and `activeWorkspaceId === 'B'` (A's late resolution is ignored).

- [ ] **Step 2: Run test** → FAIL (A clobbers B).

- [ ] **Step 3: Implement** — in `git.store.ts` `load`, guard each `set` that applies resolved data:

```ts
      const status = await gitApi.status(workspaceId);
      if (get().activeWorkspaceId !== workspaceId) return; // superseded
      if (!status.isRepo) { set({ status, commits: [], truncated: false, loading: false }); return; }
      const { commits, truncated } = await gitApi.log(workspaceId, maxCount);
      if (get().activeWorkspaceId !== workspaceId) return; // superseded
      set({ status, commits, truncated, loading: false });
```

In `gitChanges.store.ts` `load`, guard before applying `changes`:

```ts
      const changes = await gitApi.changes(workspaceId);
      if (get().activeWorkspaceId !== workspaceId) return;
      set({ changes, loading: false });
```

And in `refresh`, capture `const id = get().activeWorkspaceId` and after the await re-check `if (get().activeWorkspaceId !== id) return;` before `set`.

- [ ] **Step 4: Verify** → PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/stores/git.store.ts src/stores/gitChanges.store.ts src/stores/git.store.test.ts
git commit -m "fix(git-store): ignore out-of-order loads on rapid workspace switch"
```

### Task C4: SwarmEditModal load has error handling (SwarmEditModal)

**Files:** Modify `src/components/swarms/SwarmEditModal.tsx` (~13-20)

- [ ] **Step 1: Write the failing test** — render `SwarmEditModal` with `swarmsApi.get` rejecting; assert it surfaces an error state / does not allow Save to submit empty `name`+`steps`.

- [ ] **Step 2: Run test** → FAIL (unhandled rejection / silent blank form).

- [ ] **Step 3: Implement** — add `.catch` to the load effect and a `loadError` state; disable/guard Save while the record failed to load:

```ts
  useEffect(() => {
    if (id !== 'new') {
      void swarmsApi.get(id)
        .then((rec) => { setName(rec.name); setSteps(rec.steps); })
        .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load swarm'));
    }
  }, [id]);
```

Render `loadError` if set and prevent submit when `id !== 'new' && loadError`.

- [ ] **Step 4: Verify** → PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/swarms/SwarmEditModal.tsx src/components/swarms/SwarmEditModal.test.tsx
git commit -m "fix(swarms): handle load failure in edit modal (no blank-overwrite)"
```

---

## Phase D — Data & performance

### Task D1: Workspace-delete cascade + scheduler skips orphans (C2)

**Files:** Modify `server/domain/workspaces/workspaces.store.ts` (`delete`), `server/domain/schedules/scheduler.service.ts` (run path)

- [ ] **Step 1: Write the failing test** — `workspaces.store.test.ts`: create a workspace, insert a schedule and a swarm referencing its id, call `delete(id)`, assert the schedule/swarm rows now have `workspace_id === null` (not dangling).

- [ ] **Step 2: Run test** → FAIL (rows keep the stale id).

- [ ] **Step 3: Implement** — replace `delete`:

```ts
  delete(id: string): void {
    const tx = this.db.transaction((wid: string) => {
      for (const t of ['schedules', 'swarms', 'swarm_steps'] as const) {
        const exists = this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
        if (exists) this.db.prepare(`UPDATE ${t} SET workspace_id = NULL WHERE workspace_id = ?`).run(wid);
      }
      this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(wid);
    });
    tx(id);
  }
```

- [ ] **Step 4: Scheduler guard test** — `scheduler.service.test.ts`: a due schedule whose `workspace_id` is set but does not resolve (`workspacesStore.get` → undefined) is skipped and logged, NOT run against `process.cwd()`.

- [ ] **Step 5: Implement scheduler guard** — in the run path, before dispatching a schedule: `if (schedule.workspaceId && !workspacesStore.get(schedule.workspaceId)) { logger.warn('skipping schedule with dangling workspace', ...); continue; }`.

- [ ] **Step 6: Verify** → both tests PASS; `npm run lint` clean.

- [ ] **Step 7: Commit**

```bash
git add server/domain/workspaces/workspaces.store.ts server/domain/schedules/scheduler.service.ts server/domain/workspaces/workspaces.store.test.ts server/domain/schedules/scheduler.service.test.ts
git commit -m "fix(workspaces): null dependent workspace_id on delete; scheduler skips dangling refs"
```

### Task D2: Cheap provider-name read on the dispatch hot path (P1a)

**Files:** Modify `server/domain/history/history.store.ts` (add `getProviderName`), `server/domain/dispatch/dispatch.service.ts:417-419`

**Interfaces:** Produces `HistoryStore.getProviderName(sessionId: string): string | null`.

- [ ] **Step 1: Write the failing test** — `history.store.test.ts`: seed a session with a `provider_name`; assert `getProviderName(id)` returns it and (if the store exposes a prepared-statement/query counter, or via a spy on `db.prepare`) that it does not call `readMessages`.

- [ ] **Step 2: Run test** → FAIL (method missing).

- [ ] **Step 3: Implement** — add to `HistoryStore`:

```ts
  getProviderName(sessionId: string): string | null {
    const row = this.db.prepare('SELECT provider_name FROM sessions WHERE id = ?').get(sessionId) as { provider_name: string | null } | undefined;
    return row?.provider_name ?? null;
  }
```

In `dispatch.service.ts`, replace lines 417-419:

```ts
    const sessionName = this.deps.historyStore.getProviderName(sessionId);
```

(Delete the now-unused `sessionRecord`/`readRecord` call. Confirm `readRecord` isn't used elsewhere in `handle()` before line 676 — the review confirmed it isn't.)

- [ ] **Step 4: Verify** → PASS; run the full dispatch test suite → green; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/domain/history/history.store.ts server/domain/dispatch/dispatch.service.ts server/domain/history/history.store.test.ts
git commit -m "perf(dispatch): read provider_name with a scalar query instead of full history"
```

### Task D3: Batch reasoning/tool-trace reads; hoist prepared statements (P1b)

**Files:** Modify `server/domain/history/history.store.ts` (`readMessages`, `readReasoningSteps`, `readToolCallTrace`)

- [ ] **Step 1: Write the failing test** — `history.store.test.ts`: seed a session with N messages, each with reasoning steps and tool-call traces; wrap `db.prepare` with a spy/counter; call `read(sessionId)` and assert the number of `prepare` calls is O(1) (a small constant), not O(N+K). Assert the reconstructed messages are byte-identical to the current output (snapshot the returned `Message[]`).

- [ ] **Step 2: Run test** → FAIL (prepare called per message/step).

- [ ] **Step 3: Implement** — mirror the attachment batch pattern already at lines 396-407:
  - Fetch all reasoning steps for the session in one query: `SELECT ... FROM reasoning_steps WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?) ORDER BY message_id, position`, group into `Map<messageId, ReasoningRow[]>`.
  - Fetch all tool-call traces for those steps in one query: `SELECT ... FROM tool_call_traces WHERE reasoning_step_id IN (SELECT id FROM reasoning_steps WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?))`, group into `Map<reasoningStepId, ToolCallRow>`.
  - Rewrite `readMessages` to consume the two maps (preserving the exact row→object mapping already in `readReasoningSteps`/`readToolCallTrace` — move that mapping into local helpers that take a row, not a query).
  - Keep prepared statements as class fields prepared once in the constructor.

- [ ] **Step 4: Verify** — snapshot test PASS (output unchanged), prepare-count assertion PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/domain/history/history.store.ts server/domain/history/history.store.test.ts
git commit -m "perf(history): batch reasoning/tool-trace reads, hoist prepared statements (kill N+1)"
```

### Task D4: openai-compat defaults to `vision:false` (P2)

**Files:** Modify `server/index.ts` (`openAICompatBuilder`, ~169-170)

- [ ] **Step 1: Write the failing test** — `server/domain/dispatch/providers/openai.provider.test.ts` (or a registry test): construct a provider via the openai-compat builder path and assert `capabilities.vision === false` while a native OpenAI provider stays `vision: true`.

- [ ] **Step 2: Run test** → FAIL (compat defaults to vision:true).

- [ ] **Step 3: Implement** — in `openAICompatBuilder`, pass explicit capabilities:

```ts
  openAICompatBuilder: (baseUrl, model, headers) =>
    new OpenAIProvider({
      apiKey: '', model, baseUrl: `${baseUrl}/chat/completions`, headers,
      capabilities: { thinking: false, toolCalling: true, vision: false },
    }),
```

- [ ] **Step 4: Verify** → PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts server/domain/dispatch/providers/openai.provider.test.ts
git commit -m "fix(providers): openai-compat defaults vision:false (image to text-only backend no longer fails dispatch)"
```

---

## Phase E — CLI & hygiene

### Task E1: `--help` and `--port` validation (C6)

**Files:** Modify `cli/args.ts`; test `cli/args.test.ts`

- [ ] **Step 1: Write the failing test** — `cli/args.test.ts`

```ts
import { parseArgs } from '@/cli/args';
it('treats --help/-h as the help command', () => {
  expect(parseArgs(['--help']).command).toBe('help');
  expect(parseArgs(['-h']).command).toBe('help');
});
it('rejects a non-numeric --port', () => {
  expect(() => parseArgs(['--port', 'daemon', 'status'])).toThrow(/--port/);
  expect(() => parseArgs(['--port', 'xyz'])).toThrow(/--port/);
});
it('accepts a valid --port', () => {
  expect(parseArgs(['--port', '3001', 'daemon', 'status']).flags.port).toBe(3001);
});
```

- [ ] **Step 2: Run test** → FAIL.

- [ ] **Step 3: Implement** — in `parseArgs`, handle help and validate port:

```ts
    if (arg === '--json') { flags.json = true; }
    else if (arg === '--help' || arg === '-h') { return { command: 'help', flags }; }
    else if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i];
      if (arg === '--provider') flags.provider = value;
      else if (arg === '--session') flags.session = value;
      else if (arg === '--port') {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`--port requires a valid port number (got: ${value ?? 'nothing'})`);
        flags.port = n;
      }
    } else { positionals.push(arg); }
```

(Return `{ command: 'help' }` short-circuits, so `--help` anywhere prints help. Ensure `cli/index.ts` maps `command === 'help'` to `helpText()` — it already does for bare invocation.)

- [ ] **Step 4: Verify** → PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add cli/args.ts cli/args.test.ts
git commit -m "fix(cli): recognize --help/-h and validate --port"
```

### Task E2: Resolve server bundle from `__dirname` + `windowsHide` (C5 + hygiene)

**Files:** Modify `cli/runtime.ts:22-37`

- [ ] **Step 1: Write the failing test** — `cli/runtime.test.ts`: assert `defaultDeps({}).serverEntry` ends with `dist/server.cjs` (or the colocated path) and is derived from the module dir, not `process.cwd()` (run the assertion from a different cwd via `process.chdir` in the test, then restore).

```ts
it('resolves serverEntry next to the CLI bundle, independent of cwd', () => {
  const cwd = process.cwd();
  try { process.chdir(os.tmpdir()); const deps = defaultDeps({}); expect(deps.serverEntry.endsWith(path.join('dist','server.cjs')) || deps.serverEntry.endsWith('server.cjs')).toBe(true); }
  finally { process.chdir(cwd); }
});
```

- [ ] **Step 2: Run test** → FAIL (uses `process.cwd()`).

- [ ] **Step 3: Implement** — in `runtime.ts`:
  - `serverEntry: path.resolve(__dirname, 'server.cjs'),` (the esbuild CJS `cli.cjs` and `server.cjs` are colocated in `dist/`; `__dirname` is available in the CJS bundle). During `vitest` (running the TS source, not the bundle) `__dirname` is `cli/`, so the runtime resolves `cli/server.cjs`; that's fine for the cwd-independence assertion. If a stricter prod-layout test is wanted, assert on a `resolveServerEntry(dir)` pure helper instead and unit-test that.
  - Add `windowsHide: true` to the `nodeSpawn('node', [entry], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...env } })`.

- [ ] **Step 4: Verify** → PASS; `npm run build` still produces a runnable `dist/cli.cjs` (smoke: `node dist/cli.cjs --help` prints help); `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add cli/runtime.ts cli/runtime.test.ts
git commit -m "fix(cli): resolve server bundle from module dir (global install) + windowsHide on spawn"
```

### Task E3: Ctrl+C exits in non-daemon mode

**Files:** Modify `server/index.ts:328-340`

- [ ] **Step 1: Write the failing test** — this is hard to unit-test cleanly; instead add a focused test only if the signal wiring is extracted into a pure `installShutdown({ isDaemon, server, scheduler, dataDir })` function. Extract it, then test that for `isDaemon: false` the returned handler closes the server and calls the injected `exit` spy.

- [ ] **Step 2: Run test** → FAIL.

- [ ] **Step 3: Implement** — replace lines 328-340 so BOTH modes exit cleanly:

```ts
  if (process.env.AETHER_SCHEDULER !== '0') scheduler.start();
  const server = /* capture the return of app.listen(...) above */;
  const shutdown = () => {
    scheduler.stop();
    if (isDaemon) clearDaemonFile(cfg.dataDir);
    server.close(() => process.exit(0));
    // Failsafe: exit even if a socket lingers.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  if (isDaemon) process.on('exit', () => clearDaemonFile(cfg.dataDir));
```

(Assign `const server = app.listen(...)` at line 316.)

- [ ] **Step 4: Verify** → test PASS; manual: `npm run dev`, press Ctrl+C, process exits and frees the port; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts
git commit -m "fix(server): Ctrl+C/SIGTERM cleanly shuts down in non-daemon mode too"
```

### Task E4: `stopDaemon` liveness check before kill

**Files:** Modify `cli/daemon.ts:66-76`

- [ ] **Step 1: Write the failing test** — `cli/daemon.test.ts`: with a `DaemonDeps` whose `kill` spy throws `ESRCH` for a dead pid, assert `stopDaemon` still clears the info file and returns; and add a dep `isAlive(pid)` so that when the recorded pid is not alive, `kill` is not called at all.

- [ ] **Step 2: Run test** → FAIL (kills unconditionally).

- [ ] **Step 3: Implement** — add `isAlive?: (pid: number) => boolean` to `DaemonDeps` (default in `runtime.ts`: `(pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }`). In `stopDaemon`:

```ts
export async function stopDaemon(d: DaemonDeps): Promise<boolean> {
  const info = d.readInfo();
  if (!info) return false;
  const alive = d.isAlive ? d.isAlive(info.pid) : true;
  if (alive) { try { d.kill(info.pid); } catch { /* raced to exit */ } }
  d.clearInfo();
  return true;
}
```

- [ ] **Step 4: Verify** → PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add cli/daemon.ts cli/runtime.ts cli/daemon.test.ts
git commit -m "fix(cli): check daemon pid liveness before SIGTERM (reused-PID hazard)"
```

### Task E5: `listLiveTools` shows builtin fs/git tools in the policy UI

**Files:** Modify `server/routes/mcp.routes.ts:86` (+ `registry.listLiveTools` filter if needed)

- [ ] **Step 1: Write the failing test** — `mcp.routes.test.ts` (or `registry.test.ts`): with a live builtin filesystem tool registered, `GET /api/mcp/tools` (or `listLiveTools(undefined)`) currently excludes it. Assert the fixed behavior returns the fs/git tools.

- [ ] **Step 2: Run test** → FAIL (fs/git excluded when `root` is absent).

- [ ] **Step 3: Implement** — thread the active workspace `root` into the route (from the query/session) and call `registry.listLiveTools(root)`; OR adjust the filter so that a missing `root` means "don't filter fs/git" rather than "exclude all". Minimal filter fix in `registry.ts:169-180`:

```ts
    const filterFsGit = Boolean(root);
    for (const entry of this.live.values()) {
      const id = entry.serverId;
      const isFsOrGit = id.startsWith('builtin:filesystem') || id.startsWith('builtin:git');
      if (filterFsGit && isFsOrGit && id !== fsId && id !== gitId) continue;
      // ...
```

- [ ] **Step 4: Verify** → PASS; `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/registry.ts server/routes/mcp.routes.ts server/domain/mcp/registry.test.ts
git commit -m "fix(mcp): don't hide builtin fs/git tools from the policy list when no root is given"
```

### Task E6: Dependency CVE bumps

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Baseline** — `npm audit` (note the 6 high advisories: `vite`, `ws`, `protobufjs`, `launch-editor`).

- [ ] **Step 2: Apply non-breaking fixes** — `npm audit fix` (no `--force`). Review the lockfile diff; if a fix requires a major bump (e.g. `vite`), evaluate separately and leave a note rather than force it.

- [ ] **Step 3: Verify** — `npm run lint` clean; `npm run test:run` green; `npm run build` succeeds; `node dist/cli.cjs --help` works.

- [ ] **Step 4: Re-audit** — `npm audit` and record any advisory intentionally left (major bump deferred).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): npm audit fix (non-breaking) for high-severity advisories"
```

---

## Final verification

- [ ] `npm run lint` → clean
- [ ] `npm run test:run` → all green (both projects)
- [ ] `npm run test:coverage` → thresholds still met on `server/domain/**`, `server/lib/**`, `src/hooks/**`, `src/stores/**`, `src/lib/**`
- [ ] `npm run build` → succeeds; `node dist/cli.cjs --help` prints help
- [ ] Manual smoke: `AETHER_FAKE_PROVIDER=1 npm run dev`, confirm loopback bind logged, Ctrl+C exits cleanly
- [ ] Open a PR from `fix/code-review-remediation` summarizing the 21 fixes by phase
