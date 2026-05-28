# Slice 24 — Headless Daemon + `aether-cli` — Design

**Branch:** `feat/slice-24-headless-cli`
**Date:** 2026-05-29
**Status:** approved (design), pending implementation plan

## Goal

Package the existing Aether server as a daemonizable background process and ship a
thin CLI (`aether`) that streams to/from it over the existing HTTP+SSE endpoints.
Enable zero-friction terminal use, including Unix piping:

```bash
cat error.log | aether "explain this"
```

Sessions created by the CLI are persisted in the same SQLite DB and therefore
visible in the web UI.

## Scope decisions (from brainstorming)

- **Daemon model:** full lifecycle — `aether daemon start|stop|status|restart`.
  The CLI spawns a detached server process, tracks it via a PID/endpoint file,
  and manages stop/status. No manual `npm start` required.
- **Sessions:** new session per invocation (one-shot). `--session <id>` continues
  an existing session. The created session id is printed to stderr for reuse.
- **Output (text mode, default):** clean stdout — only the model's final text goes
  to stdout (pipe-friendly). `thinking` and `function_call` events go to stderr,
  dimmed. `--json` emits structured events (JSONL) on stdout.
- **Packaging:** sources in `cli/`, single entrypoint `cli/index.ts`, added to the
  root `package.json` `bin`, bundled by esbuild into `dist/cli.cjs`. One package,
  consistent with the existing build.
- **Discovery & bind:** the daemon writes `${dataDir}/daemon.json`
  (`{ pid, host, port, startedAt }`); the CLI reads it to find the endpoint. The
  daemon binds `127.0.0.1` (local-first safety) when launched as a daemon. Port
  stays configurable via `PORT` / `--port`.
- **Daemon process:** runs the standard Aether server (`bootstrap()` via the built
  `dist/server.cjs`), so the web UI is served too and CLI sessions appear there.
  `npm run build` is a prerequisite for `aether daemon start`.

## Architecture

```
cli/
  index.ts          # bin entrypoint: arg parsing + command router
  daemon.ts         # start/stop/status/restart: detached spawn, PID file, health poll
  client.ts         # HTTP+SSE client to the daemon (create session + dispatch)
  sse-consumer.ts   # plain-text SSE parser for node (text/thinking/function_call/done/error)
  output.ts         # rendering: stdout=text, stderr=thinking/tool, --json passthrough
  config.ts         # endpoint resolution from daemon.json / PORT / --port
```

Server-side changes (minimal):

- `server/index.ts`: when `AETHER_DAEMON=1`, bind `127.0.0.1` (instead of `0.0.0.0`)
  and write `${dataDir}/daemon.json` on `listen()`. Remove the file on
  `SIGTERM` / `exit`.
- `package.json`: add `"bin": { "aether": "dist/cli.cjs" }` and an esbuild step that
  bundles `cli/index.ts` → `dist/cli.cjs` (alongside the existing server bundle).
- `vitest.config.ts`: add `cli/**` to the backend (node) project match, and to the
  coverage-enforced paths (80% threshold).

### Approaches considered

- **A — thin CLI over existing HTTP endpoints (chosen).** No new server domain;
  CLI is a pure SSE client plus a small daemon-manager. Reuses `POST /api/sessions`,
  `POST /api/ai/dispatch`, `GET /api/health`. Minimal surface, isolated, testable.
- **B — dedicated CLI API endpoints** (e.g. `POST /api/cli/run`). Rejected:
  duplicates already-exposed logic, grows API surface, violates YAGNI.
- **C — shared extracted client library** between SPA and CLI. Rejected: SPA uses
  browser fetch/EventSource, CLI uses node http — the shared abstraction is fragile
  and the refactor is out of scope.

## Commands & flags

- `aether daemon start|stop|status|restart`
- `aether "<prompt>"` — one-shot: create session, dispatch, stream.
- `aether --session <id> "<prompt>"` — continue an existing session.
- Global flags: `--json`, `--provider <name>`, `--port <n>`, `--verbose`.
- stdin pipe: when stdin is not a TTY, its content is appended to the prompt inside
  a fenced code block (`prompt arg` + fenced `stdin`).

## Data flow

### `aether daemon start`
1. Read `daemon.json`; if present and `GET /api/health` responds → "already running",
   exit 0.
2. Else `spawn('node', ['dist/server.cjs'], { detached: true, stdio: ['ignore', log, log],
   env: { ...process.env, AETHER_DAEMON: '1' } })`, then `unref()`.
3. The server (with `AETHER_DAEMON=1`) binds `127.0.0.1`, writes `daemon.json` on
   `listen()`, and removes it on `SIGTERM`/`exit`.
4. The CLI polls `/api/health` up to ~10s; on success print pid+port, else kill and
   report the log tail.

### `aether "<prompt>"`
1. Resolve endpoint (`config.ts`: `--port` > `daemon.json` > `PORT` > 3000). If health
   fails → error with hint `aether daemon start`.
2. If stdin is not a TTY, read it and append to the prompt in a fenced block.
3. Without `--session`: `POST /api/sessions` → new `sessionId` (printed to stderr).
4. `POST /api/ai/dispatch` `{ sessionId, message, providerName? }`, read the response
   as an SSE stream.
5. `sse-consumer` emits events → `output`: `text`→stdout, `thinking`/`function_call`→
   stderr (dim), `done`→flush + exit 0.

### `stop` / `status`
- `stop`: read pid, `SIGTERM`, wait, remove stale file.
- `status`: read file + health → table `running/stopped, pid, port, uptime`.

## Error handling
- **Daemon unreachable** (one-shot): exit 3, stderr message with hint.
- **Stale PID file** (dead pid / health KO): treated as "not running" and cleaned up.
- **SSE `error` event** (provider/dispatch failure): print message to stderr, exit 1;
  flag `retryable` if set.
- **Stream interrupted / connection lost**: exit 1, formatted error (no raw stacktrace).
- **`--json`**: each SSE event serialized one-line-per-event (JSONL) on stdout; errors
  become `{"type":"error",...}`.

## Breakpoints (gate) — scoped limitation
A dispatch may emit a gate event for MCP tools with `gate` policy (slice 22, 60s
approval wait). For this slice, the one-shot CLI **auto-rejects** gated tool calls and
notes it on stderr (`tool X requires approval: skipped`), avoiding an interactive
block. Interactive approval from the CLI is explicitly **out of scope** (possible
follow-up).

## Testing
- **Backend** (`server/**`, node project): `127.0.0.1` bind + `daemon.json`
  write/cleanup when `AETHER_DAEMON=1`.
- **CLI** (`cli/**/*.test.ts`):
  - `config.ts`: endpoint resolution precedence.
  - `sse-consumer.ts`: chunk parsing → events (text/thinking/function_call/done/error)
    including streams split mid-line.
  - `output.ts`: stdout vs stderr routing, `--json` mode.
  - `daemon.ts`: stale-PID detection, "already running" (with fake server/health).
- **No Playwright e2e** (no UI). A real-binary smoke test stays manual.
- Coverage: add `cli/**` to the enforced 80% paths.

## Out of scope
- Interactive breakpoint approval from the CLI.
- RAG / codebase-aware features.
- Multi-daemon orchestration on one host (single `daemon.json`).
```
