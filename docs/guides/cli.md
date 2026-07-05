# CLI

What this covers: the headless `aether` CLI — the background daemon it talks to, one-shot prompt dispatch, and its stdout/stderr/JSON output modes. Read this when you're scripting against Aether, debugging a CLI flag, or changing daemon lifecycle behavior.

## How it works

**Daemon lifecycle**: the CLI is a thin client over the same Express server the web UI uses, run as a detached background process. `aether daemon start` (`cli/daemon.ts` `startDaemon`, wired in `cli/index.ts`) first probes `/api/health` — if something's already listening, it reports `already: true` rather than spawning a duplicate (which would otherwise fail silently with `EADDRINUSE` under `stdio: 'ignore'`). Otherwise it spawns `node dist/server.cjs` (`cli/runtime.ts` `defaultDeps`) detached, forcing `NODE_ENV=production` so it serves the prebuilt SPA from `dist/` rather than trying to mount Vite — **`npm run build` is a prerequisite** for `daemon start` to work. It polls health every 500 ms (40 attempts) until the server responds. The daemon binds `127.0.0.1` (loopback only, per `resolveEndpoint()` in `cli/config.ts`, which also honors a `daemon.json` file and `PORT`/`--port`). `aether daemon status` reports `running`/`stopped` plus pid/port; `aether daemon stop` sends `SIGTERM` to the recorded pid and clears the daemon file; `aether daemon restart` stops then starts.

**One-shot prompts**: `aether "<prompt>"` creates a new session (unless `--session ID` is given to reuse one, printed to stderr as `aether: session <id>` so stdout stays reply-only) and dispatches the prompt exactly like the web UI would, streaming the SSE response. `--provider <name>` overrides the provider for that dispatch (see [Providers](providers.md) for the selection precedence it slots into).

**Stdin piping**: if stdin isn't a TTY, the CLI reads it fully and appends it to the prompt as a fenced code block (`cli/index.ts` `readStdin`) — e.g. `cat file.ts | aether "review this"`.

**Output modes**: by default (`cli/output.ts` `handleEvent`), `text` chunks go to **stdout** (so `aether "prompt" > out.txt` captures only the model's reply), while `thinking` chunks, tool-call request/result lines, and the session-id line all go to **stderr**, dimmed. With `--json`, every SSE event is instead written to stdout as one JSON object per line (JSONL) — including `done`/`error` — for scripting.

**Gated tool calls are auto-rejected, not left to time out**: unlike the web UI (which shows an approve/reject prompt), the CLI has no interactive gate. When a `tool_call_request` SSE event arrives for a gated call, `cli/index.ts` immediately calls `rejectDecision(baseUrl, callId)` (`cli/client.ts`), which POSTs `{ callId, action: 'reject' }` to `/api/mcp/decision` — best-effort, a failed reject call must never crash the stream. This means a CLI-driven dispatch never sits waiting on the [breakpoints](breakpoints.md) 24-hour gate timeout; dangerous/external tool calls are actively rejected within the same request.

**Shared storage**: the CLI and the web UI are the same server process talking to the same SQLite database — a session created via the CLI shows up in the web UI's session list and vice versa, and `--session <id>` lets a script continue a conversation started in either place.

## Key files

- `cli/index.ts` — `main`, `runPrompt`: argument dispatch, stdin piping, the auto-reject wiring
- `cli/args.ts` — `parseArgs`: `--json`, `--open`, `--provider`, `--session`, `--port`, `daemon <action>`
- `cli/daemon.ts` — `startDaemon`/`statusDaemon`/`stopDaemon`
- `cli/runtime.ts` — `defaultDeps`: spawns `dist/server.cjs` with `NODE_ENV=production`
- `cli/config.ts` — `resolveEndpoint`: `127.0.0.1` binding, port resolution order
- `cli/output.ts` — `handleEvent`: stdout/stderr split, `--json` JSONL mode
- `cli/client.ts` — `createSession`, `dispatch`, `rejectDecision`

## See also

- [Breakpoints](breakpoints.md) — the approval gate the CLI auto-rejects rather than waits on
- [Providers](providers.md) — `--provider` and the provider-selection precedence it fits into
- [Architecture](../architecture.md) — the single-process Express + SSE model the CLI relies on
