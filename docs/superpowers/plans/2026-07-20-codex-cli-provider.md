# Aether — Codex CLI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex CLI (ChatGPT-subscription auth, no API key) as a first-class provider: spawn `codex exec --json`, map its JSONL events to `ProviderChunk`, and expose Aether's MCP tools to the Codex process through a loopback streamable-HTTP MCP bridge so approval gating/tracing stay intact.

**Architecture:** New `CodexProvider` (agentic-internal-loop family, like `AnthropicProvider`): flattened conversation on stdin, JSONL parser on stdout, tool calls re-entering via `req.runToolCall` through a per-dispatch token-scoped bridge endpoint. Registry gains transport `codex` gated by binary+login detection; models = hardcoded list + user's `~/.codex/config.toml` default.

**Reference spec:** `docs/superpowers/specs/2026-07-20-codex-cli-provider-design.md`

**Branch:** `feat/codex-cli-provider` (already checked out; spec committed alongside this plan)

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  lib/
    codex-auth.ts                                 # NEW: resolveCodexBinary + detectCodexAuth
    codex-auth.test.ts                            # NEW
  domain/mcp/bridge/
    bridge.service.ts                             # NEW: token → {tools, runToolCall} registry
    bridge.service.test.ts                        # NEW
  routes/
    mcp-bridge.routes.ts                          # NEW: POST /api/mcp-bridge/:token (JSON-RPC)
    mcp-bridge.routes.test.ts                     # NEW
  domain/dispatch/providers/
    codex.provider.ts                             # NEW: spawn + JSONL parser
    codex.provider.test.ts                        # NEW (fixture-driven, fake codex script)
    __fixtures__/codex-events/*.jsonl             # NEW: happy path, thinking, tool call, turn.failed
  domain/providers/
    discovery.ts                                  # MODIFY: codexHardcodedModels + readCodexDefaultModel
    discovery.test.ts                             # MODIFY
    registry.ts                                   # MODIFY: transport 'codex' + builder + deps
    registry.test.ts                              # MODIFY
    auth-status.ts                                # MODIFY: probeCodex
    auth-status.test.ts                           # MODIFY
    auth-status.types.ts                          # MODIFY: TRANSPORT_ORDER += 'codex'
  app.ts                                          # MODIFY: mount bridge route when dep present
  index.ts                                        # MODIFY: wire codexBuilder + bridge service + port
docs/…                                            # MODIFY: provider docs EN + IT sync
README.md                                         # MODIFY: provider/env table row
```

---

## Phase A — Pre-flight

### Task A1: Verify branch + clean tree

- [x] `git rev-parse --abbrev-ref HEAD` → `feat/codex-cli-provider`; `git status --porcelain` → only spec/plan docs. Commit docs: `docs(codex): spec + plan for Codex CLI provider`.
- [x] Verify current model slugs: run `codex features` / check Codex docs; record the hardcoded list to use in Task D1 (fallback if unverifiable: `['gpt-5.6-sol']` + config default).

## Phase B — Auth/detection lib

### Task B1: `server/lib/codex-auth.ts`

- [x] `resolveCodexBinary(): string | null` — PATH lookup, Windows `codex.cmd`/`codex.exe` variants (mirror `claude-code-executable.ts`).
- [x] `detectCodexAuth(): Promise<'oauth' | 'none'>` — binary resolvable AND `${CODEX_HOME ?? ~/.codex}/auth.json` exists. No network probe.
- [x] Tests: fake PATH dir + fake auth.json via temp dirs; Windows-shaped names covered. Commit.

## Phase C — MCP bridge

### Task C1: `bridge.service.ts`

- [x] `McpBridgeService`: `register(tools, runToolCall) → token` (crypto.randomUUID), `get(token)`, `unregister(token)`, TTL sweep 25h. Pure in-memory, no persistence.
- [x] Tests: register/get/unregister, unknown token, TTL expiry (fake timers). Commit.

### Task C2: `mcp-bridge.routes.ts` + app wiring

- [x] `createMcpBridgeRoutes(service)`: single `POST /:token` handling JSON-RPC `initialize`, `tools/list`, `tools/call` (delegates to `runToolCall`, maps outcome to `{content:[{type:'text',…}], isError}`); unknown token → 404, unknown method → JSON-RPC error.
- [x] `app.ts`: mount at `/api/mcp-bridge` only when `deps.mcpBridgeService` present (optional-dep pattern).
- [x] Tests: supertest through `createApp` with only bridge dep — proves minimal-app wiring. Commit.

## Phase D — Codex provider

### Task D1: `codex.provider.ts` skeleton + JSONL parser

- [x] `CodexProvider implements AIProvider` with opts `{ model, binaryPath, bridgeBaseUrl, bridgeService }`; capabilities `{thinking:true, toolCalling:true, vision:true}`.
- [x] Pure function `parseCodexEvent(line) → ProviderChunk | null` (exported for tests): `agent_message`→text, `agent_reasoning`→thinking, `turn.completed`→done+usage, `turn.failed`/`error`→throwable marker; unknown/malformed → null.
- [x] Fixture files under `__fixtures__/codex-events/`. Tests for the parser against fixtures. Commit.

### Task D2: spawn + stream loop

- [x] Build argv per spec §4.1 (`--json --ephemeral --skip-git-repo-check -s read-only --ignore-user-config -m <model>`, `-c mcp_servers.aether.url=<bridgeBaseUrl>/<token>`); prompt via stdin (`renderConversation` flatten — extract/share the helper from anthropic.provider rather than duplicating).
- [x] `spawn(..., { windowsHide: true })`; stderr buffered and appended to thrown errors; abort → SIGTERM then SIGKILL after 2s grace; bridge `register` before spawn / `unregister` + temp-file cleanup in `finally`.
- [x] Image attachments → temp files + `-i` flags.
- [x] Tests use a **fake codex script** (Node one-liner emitting fixture JSONL; also an infinite-sleep variant for abort tests) as `binaryPath` — no real CLI needed. Cover: happy path, thinking on/off, turn.failed (rate-limit message surfaced), abort kills child, stderr in error, bridge register/unregister called. Commit.

## Phase E — Registry + status wiring

### Task E1: discovery + registry

- [x] `discovery.ts`: `codexHardcodedModels()` (list from Task A1) and `readCodexDefaultModel()` (regex `^model\s*=\s*"…"` over `${CODEX_HOME ?? ~/.codex}/config.toml`; null on any error).
- [x] `registry.ts`: `ProviderTransport` += `'codex'`; deps += `detectCodexAuth`, `codexBuilder`; `// Codex` block in `refresh()` (dedup hardcoded ∪ config default, entries `codex:<model>`, display `Codex CLI / <model>`); `defaultName()` — append at end, never auto-default.
- [x] Tests: gated on detection none/oauth; config-default dedup; defaultName unchanged for existing transports (NRT). Commit.

### Task E2: auth-status + composition root

- [x] `auth-status.types.ts`: `TRANSPORT_ORDER` += `'codex'`; `auth-status.ts`: `probeCodex()` → `{ok, reason:'oauth chatgpt'}` / `{unconfigured, reason:'not logged in'}`.
- [x] `index.ts`: construct `McpBridgeService`, pass to `createApp`; `codexBuilder` = `new CodexProvider({model, binaryPath: resolveCodexBinary(), bridgeBaseUrl: http://127.0.0.1:${port}/api/mcp-bridge, bridgeService})`. Bridge URL must use the **actual** bound port.
- [x] Tests: auth-status cases; boot smoke (`AETHER_FAKE_PROVIDER=1`) still green. Commit.

## Phase F — Docs + verification

### Task F1: docs

- [x] README provider table + env notes (`CODEX_HOME` respected, no key needed); `docs/` provider page EN + IT sync (rule from PR #119). Commit.

### Task F2: end-to-end verification (manual, HITL)

- [x] `npm run lint`, `npm run test:run`, `npm run test:coverage` (thresholds green).
- [ ] With real CLI (quota permitting — user's resets 2026-07-25): dispatch from UI on `codex:<model>`, confirm streaming, a gated MCP tool call via bridge, and abort. Record results in PR body.
- [x] Open PR to `main` with spec/plan links; note Anthropic-OAuth non-regression (untouched files list).

---

## Explicit non-goals (v1)

Sandbox toggle in UI; `codex mcp-server` / app-server integration; per-token streaming; retry on rate limit; Windows smoke (tracked separately, same as 0.1.24 rule).
