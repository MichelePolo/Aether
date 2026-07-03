# Spec — Code-review remediation

**Date:** 2026-07-02
**Branch (origin):** `feat/pages-site` (fixes will land on a dedicated `fix/code-review-remediation` branch)
**Source:** full-project code review (2026-07-02), 8 parallel subsystem reviewers, excluding `site .superpowers .playwright-mcp .github .claude`.

## Goal

Remediate all 21 findings from the code review in one coherent, phased effort. Fixes are grouped into 5 workstreams by *fix character* (shared root cause / shared test approach), not by file. Every fix with observable runtime behavior is pinned by a failing test first (TDD). Trivial hygiene items are verified by build/type-check.

Baseline: `npm run lint` (tsc `--noEmit`) is currently green and must stay green.

## Findings index

| ID | Sev | Location | One-line |
|----|-----|----------|----------|
| S1 | 🔴 | `server/index.ts:314`, `server/routes/providers.routes.ts:180` | API binds `0.0.0.0` with no auth; `?reveal=1` returns plaintext keys to the LAN |
| S2 | 🔴 | `server/lib/key-crypto.ts:21` | Vault key derived from `hostname\|username` + static salt: guessable, and silently loses keys when the data dir is synced across machines |
| S3 | 🟠 | `server/domain/providers/auth-status.ts:102` | Gemini auth probe puts the API key in the URL query string |
| R1 | 🟠 | `server/domain/mcp/stdio-connection.ts:76` | Write to MCP child `stdin` with no `'error'` listener → unhandled stream error crashes the process |
| R2 | 🟠 | `server/lib/sse.ts:24`, `server/routes/dispatch.routes.ts:16` | SSE emitter keeps writing after client disconnect; no `res.on('error')` anywhere → write-after-close can crash the process |
| R3 | 🟠 | `server/domain/dispatch/dispatch.service.ts:368` | Side-effecting tool call executes even after `signal.aborted` (client left) |
| R4 | 🟠 | `server/domain/mcp/http-connection.ts` | http-MCP SSE reader never aborted on timeout/close → socket/FD leak |
| R5 | 🟠 | `server/domain/mcp/registry.ts:72` (+ reconnect ~350/429) | Spawned stdio child not `close()`d when `initialize()`/`listTools()` throws → zombie processes |
| C1 | 🟠 | `src/hooks/useSwarmRun.ts:60`, `src/hooks/useTddRun.ts:52` | Missing error handling / terminal-state reset → "Run" button stuck forever + unhandled rejection |
| C2 | 🟠 | `014_schedules.sql:8`, `017_swarm_workspace.sql`, `workspaces.store.ts:56` | `workspace_id` has no FK/cleanup; deleting a workspace leaves schedules/swarms pointing at a resolved-wrong dir → unattended runs hit `process.cwd()` |
| C3 | 🟡 | `dispatch.service.ts:390` (`classifyError`) | Cancel during the provider's opening `fetch` is stored as a plain error, `interrupted` falsy → `resume()` refuses forever |
| C4 | 🟡 | `src/stores/git.store.ts:37`, `src/stores/gitChanges.store.ts:49` | No freshness guard; rapid workspace switch shows the previous repo's history/diff |
| P1 | 🟡 | `dispatch.service.ts:417`, `history.store.ts:409` | Full session history materialized twice per turn + N+1 prepared statements on the dispatch hot path |
| P2 | 🟡 | `server/domain/dispatch/providers/openai.provider.ts:56` | openai-compat models default `vision:true`; image to a text-only local model → dispatch failure instead of graceful strip |
| — | ⚪ | `server/index.ts:328` | SIGINT/SIGTERM in non-daemon mode never `process.exit()` → Ctrl+C hangs |
| — | ⚪ | `cli/runtime.ts:36` | `serverEntry` resolved from `process.cwd()` → global install can't start the daemon |
| — | ⚪ | `cli/args.ts` | `aether --help` dispatches `"--help"` as a chat prompt; `--port` with bad value → `NaN` |
| — | ⚪ | `cli/daemon.ts:66` | `stopDaemon` SIGTERMs the recorded PID with no liveness/identity check (reused-PID hazard); second-port start orphans the first daemon |
| — | ⚪ | `cli/runtime.ts:22` | spawn lacks `windowsHide:true` → console window pops on Windows |
| — | ⚪ | `server/domain/mcp/registry.ts:169`, `mcp.routes.ts:86` | `listLiveTools()` called without `root` hides all builtin fs/git tools from the policy UI |
| — | ⚪ | dependencies | 6 high npm-audit CVEs (`vite`, `ws` DoS, `protobufjs`, `launch-editor`) |

## Decisions requiring confirmation

- **[D1 / S1]** Bind `127.0.0.1` by default; add `AETHER_HOST` env for deliberate LAN exposure. The plaintext key-reveal endpoint is served **loopback-only regardless of `AETHER_HOST`**, so opting into LAN access can never expose raw keys. No auth token in this pass (revisit when the roadmap's "remote control" lands).
- **[D2 / S2]** Vault key becomes a random 32-byte key persisted at `${AETHER_DATA_DIR}/.vault.key` (mode 0600), created once; `AETHER_VAULT_KEY` (hex) overrides. Rationale: the key travels with a synced data dir, which *fixes* the cross-machine silent-loss regression and keeps zero UX friction. Accepted tradeoff: the key sits beside the ciphertext in the (possibly cloud-synced) data dir. The more-secure alternative (OS keychain / key outside data dir) is rejected because it re-breaks the documented multi-device sync workflow; `AETHER_VAULT_KEY` is the opt-in hardening path for users who want separation.
- **[D3 / C2]** SQLite cannot `ALTER TABLE ADD CONSTRAINT`, so this is fixed at the application layer: `WorkspacesStore.delete()` nulls dependent `schedules.workspace_id` / `swarms.workspace_id` / `swarm_steps.workspace_id` inside one transaction (mirroring the `ON DELETE SET NULL` intent of `sessions`). Defense-in-depth: the scheduler skips (and logs) any due schedule whose `workspace_id` no longer resolves, rather than silently falling back to `process.cwd()`.

## Workstreams

### A · Security

**S1 — loopback by default.** In `server/index.ts` compute `host` from `AETHER_HOST ?? '127.0.0.1'` (drop the `isDaemon ? loopback : 0.0.0.0` split; daemon and non-daemon both default to loopback). Log the effective bind host on boot; if it is not a loopback address, log a one-line warning that the API is reachable on the network. Add a small `isLoopbackRequest(req)` guard (checks `req.socket.remoteAddress`) and apply it to `GET /api/providers/keys/:transport` so reveal is refused (403) from non-loopback peers even when `AETHER_HOST` opens the bind.

**S2 — random per-install vault key + migration.** Rework `server/lib/key-crypto.ts`:
- `deriveKey()` → `loadOrCreateKey(dataDir)`: if `AETHER_VAULT_KEY` set, decode hex → 32 bytes; else read `${dataDir}/.vault.key`; else `randomBytes(32)`, write it with `{ mode: 0o600 }`, return it. Cache in-module.
- Keep `deriveLegacyKey()` (current hostname+salt scrypt) for migration only.
- `encrypt`/`decrypt` unchanged except they take the active key (random IV + auth-tag verification are already correct — do not touch that).
- New `migrateVaultToRandomKey(db, dataDir)` run once in `bootstrap()` after migrations: for each secret row in `provider_keys`, `ollama_endpoints`, `openai_endpoints`, attempt decrypt with the active key; on failure attempt `deriveLegacyKey()`; on success re-encrypt+persist under the active key. Idempotent (rows already under the active key decrypt on the first try and are skipped). Wrap in a transaction.
- `key-crypto.ts` must receive `dataDir` — thread it from `bootstrap()` (it already knows `AETHER_DATA_DIR`); avoid importing `os`-derived globals.

**S3 — Gemini probe header.** `auth-status.ts`: request `.../v1beta/models` with `headers: { 'x-goog-api-key': apiKey }`; remove the key from the URL. Redact any key material from thrown/formatted errors in `longDetail`.

### B · Crash & leak safety

Shared theme: streams need an `'error'` listener and long-running loops need an abort check. Fixes:
- **R1** `stdio-connection.ts`: after spawn, `this.proc.stdin.on('error', (e) => { /* log at debug; failAllPending is already handled by 'exit' */ });` so an EPIPE on a dead pipe can't become an unhandled process-level error. Keep the existing `try/catch` around `write`.
- **R2** `sse.ts`: expose a way to mark the emitter closed from outside (e.g. `markClosed()` or accept an `AbortSignal`). In `dispatch.routes.ts`, on `res.on('close')` and `res.on('error')` call it (in addition to `controller.abort()`), and register a no-op `res.on('error')` so a write-after-close never throws at the process level. `event()`/`error()`/`end()` already early-return when `closed`.
- **R3** `dispatch.service.ts`: before `toolCallsCount` bookkeeping / `gateExecuteAndTrace` (the manual `function_call` loop) and before executing an in-process Anthropic tool call, `if (signal.aborted) break;`. Ensure the turn is then persisted as `interrupted` (ties into C3).
- **R4** `http-connection.ts`: create an `AbortController` per RPC, pass `signal` to `fetch`, and on timeout / `close()` / external abort call `controller.abort()` and `reader.cancel()` so `openSseStream` stops reading.
- **R5** `registry.ts`: in the `catch` of the connect path and both reconnect paths, `await connection.close()` (guarded) before rethrowing/recording error state, so a failed `initialize()`/`listTools()` never leaks the spawned child. Hoist `connection` so it's reachable in `catch`.

### C · Async correctness

- **C1** Extract a small shared helper (e.g. `src/lib/run-sse.ts` `consumeRun(url, body, signal, reduce, onError)`) that: `fetch` → check `res.ok` (throw a typed error on non-2xx) → iterate `parseSseStream` → `finally` guarantees a terminal reset. Rewrite `useSwarmRun` and `useTddRun` on top of it so both get `try/catch`, `res.ok`, and an unconditional `running:false` when the stream ends without its `*_done` event. Distinguish `AbortError` (silent) from real failures (surface `error`).
- **C3** `classifyError` (or the `handle()`/`resume()` catch): if the caught error is an `AbortError` **or** `signal.aborted`, persist the turn with `interrupted: true` (matching the graceful-end branch) instead of a plain `error` with falsy `interrupted`, so `resume()` accepts it.
- **C4** `git.store.ts` and `gitChanges.store.ts`: before applying resolved `status`/`commits`/`changes`, `if (get().activeWorkspaceId !== workspaceId) return;` (the pattern already used by `select()` in `gitChanges.store.ts`).
- **SwarmEditModal** `SwarmEditModal.tsx`: add `.catch` to the load effect (surface an error / keep the modal from saving empty `name`/`steps` over an existing record).

### D · Data & perf

- **C2** `WorkspacesStore.delete(id)`: wrap in a transaction that first `UPDATE schedules SET workspace_id = NULL WHERE workspace_id = ?` (and same for `swarms`, `swarm_steps`), then `DELETE FROM workspaces`. In the scheduler run path, if a due schedule's `workspace_id` is set but `workspacesStore.get()` returns undefined, skip the run and log — do not fall through to `process.cwd()`.
- **P1** `dispatch.service.ts`: replace the `readRecord()`-for-providerName call with a cheap `historyStore.getProviderName(sessionId)` (`SELECT provider_name FROM sessions WHERE id = ?`). In `history.store.ts`, hoist the `reasoning_steps` and `tool_call_traces` SELECTs to prepared-once fields and batch them (`WHERE message_id IN (…)` like attachments already do), grouping in memory — eliminating the per-message/per-step N+1.
- **P2** openai-compat: default `vision:false` for provider instances built by `openAICompatBuilder` (require explicit opt-in), OR have `DispatchService` strip image attachments gracefully when the provider isn't vision-capable rather than sending an `image_url` block. Chosen: default `vision:false` for openai-compat (least surprising; matches Ollama). Revisit once endpoint config can report real per-model capabilities.

### E · CLI & hygiene

- **C5** `cli/runtime.ts`: `serverEntry: path.resolve(__dirname, 'server.cjs')` (the esbuild CJS bundle exposes `__dirname`; `cli.cjs` and `server.cjs` are colocated in `dist/`). Verify against a simulated global-install layout.
- **C6** `cli/args.ts`: recognize `--help`/`-h` → `{ command: 'help' }` (print `helpText()`); validate `--port` (`Number.isInteger` in range) and reject with a clear message instead of producing `NaN`.
- **Ctrl+C** `server/index.ts`: in non-daemon mode, the SIGINT/SIGTERM handlers must `scheduler.stop()`, close the HTTP server, and `process.exit(0)` (mirror the daemon `cleanup()`).
- **stopDaemon** `cli/daemon.ts`: before `kill(pid)`, confirm the process is alive (`process.kill(pid, 0)`), and prefer a health-check on the recorded port to avoid SIGTERMing an unrelated reused PID; clear the stale file when the PID is dead. (Full identity verification is best-effort.)
- **windowsHide** `cli/runtime.ts`: add `windowsHide: true` to the daemon `spawn`.
- **listLiveTools** `mcp.routes.ts`: pass the active workspace `root` through to `registry.listLiveTools(root)` (or adjust the filter so a missing `root` does not exclude *all* fs/git tools) so builtin fs/git tools appear in the policy UI.
- **deps** apply the non-breaking `npm audit fix` subset; re-run `npm run lint` + full test suite; note any advisory left unfixed (major-version bumps deferred).

## Testing strategy

Vitest (backend `node`, frontend `jsdom`), TDD where behavior is observable:
- **S2** vault migration round-trip: seed a row encrypted under the legacy key → run migration → `getKey` returns plaintext and the row is now new-key ciphertext; active-key rows are untouched; cross-machine sim (different hostname) decrypts via the key file.
- **S1** reveal endpoint refuses a simulated non-loopback `remoteAddress`.
- **R2** dispatch against a closed SSE response does not throw (no process error) and stops writing.
- **R3/C3** abort mid-turn → tool not executed → turn persisted `interrupted:true` → `resume()` accepted.
- **R5** `initialize()` rejection → `connection.close()` called (spy), no leaked child.
- **C1** swarm/tdd run: non-2xx response and stream-without-`*_done` both reset `running:false`.
- **C2** delete workspace → dependent schedules/swarms have `workspace_id === null`; scheduler skips an orphaned schedule.
- **C4** out-of-order `load()` resolution does not clobber the active workspace's data.
- **P1** `getProviderName` issues one query; `readMessages` issues O(1) prepared statements for N messages (assert query count / prepared-statement reuse).
- **CLI C5/C6** arg parsing (`--help`, `--port` valid/invalid), `serverEntry` resolves to the bundle dir.
- Hygiene (windowsHide, deps, listLiveTools route) verified by build/type-check + a route test for listLiveTools.

## Sequencing

Phased so the highest-risk, most self-contained fixes land first and the suite stays green after each phase:
1. **A — Security** (S1, S2, S3) — includes the boot-time vault migration; ship first.
2. **B — Crash & leak safety** (R1–R5).
3. **C — Async correctness** (C1, C3, C4, SwarmEditModal).
4. **D — Data & perf** (C2, P1, P2).
5. **E — CLI & hygiene** (C5, C6, Ctrl+C, stopDaemon, windowsHide, listLiveTools, deps).

## Out of scope

- Auth tokens / remote-control security model (deferred until the roadmap item exists).
- Per-model capability discovery for openai-compat (P2 uses a safe default now).
- Any refactor beyond what a listed fix requires.
