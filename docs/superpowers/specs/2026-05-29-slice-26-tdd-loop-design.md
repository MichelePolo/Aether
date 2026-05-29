# Slice 26 — Test-Driven Auto-Resolution (Red-Green Loop) — Design

**Branch:** `feat/slice-26-tdd-loop`
**Date:** 2026-05-29
**Status:** approved (design), pending implementation plan

## Goal

An autonomous loop: run a test command, and while it fails, dispatch a fixer
sub-agent with the failing output, then re-run — until the command passes (exit 0)
or a retry cap is reached. Surfaced as a palette command **"Auto-fix tests…"** and
streamed live as SSE.

Reuses Slice 21 (programmatic shell exec), the dispatch loop + collecting-SSE adapter
(Slice 25 plumbing), Slice 6/9 sub-agents (the fixer), and Slice 22 breakpoints (per-tool
gates fire inside each fixer turn, unchanged).

## Scope decisions (from brainstorming)

- **Test runner:** a **configurable command** (not Vitest-specific). Pass/fail is decided
  by **exit code** (`0` = green); the captured **raw output** (truncated) is fed to the
  fixer. Works for any runner (vitest/jest/pytest/go test/…). No structured/JSON parsing.
- **Fixer:** a **user-chosen sub-agent** (e.g. `@coder`), addressed via the existing
  `@mention` resolution in dispatch.
- **Approvals:** reuse the **existing per-tool breakpoint gates** — a "dangerous" edit
  inside a fixer turn pauses for approval via the current mechanism, forwarded to the UI.
  No new gate.
- **Stop conditions:** green (exit 0) / `maxRetries` reached (default 5) / client abort /
  fixer-turn error. (No "no-progress" fingerprint in v1.)
- **No persistence:** a run is transient on the SSE connection (like a swarm run). The
  transcript is a per-run chat session.

## Shared refactor

Move `server/domain/swarms/collecting-sse.ts` → **`server/lib/collecting-sse.ts`** (it is
generic SSE plumbing, now used by both swarms and tdd). Update the swarm import
(`swarm.orchestrator.ts`) and its test path. No behavior change; this avoids a
cross-domain import (tdd → swarms).

## Architecture

```
server/lib/collecting-sse.ts        # MOVED from domain/swarms (shared)
server/domain/tdd/
  tdd.types.ts        # TddRunOpts, TddRunStatus, TddRunnerDeps
  tdd.runner.ts       # runTddLoop(deps, opts, sse, signal)
server/routes/tdd.routes.ts         # POST /api/tdd/run (SSE)
server/app.ts, server/index.ts      # wiring
```

### Types

```ts
export type TddRunStatus = 'success' | 'already_green' | 'max_retries_exceeded' | 'error' | 'interrupted';

export interface TddRunOpts {
  command: string;        // e.g. "npx vitest run src/foo.test.ts"
  subAgentName: string;   // fixer
  maxRetries?: number;    // default 5
  cwd?: string;
}

export interface CommandResult {
  exitCode: number;
  output: string;         // combined stdout+stderr (+ exit-code line from the shell handler)
}

export interface TddDispatcher {
  handle(body: { sessionId: string; message: string }, sse: SseEmitter, signal: AbortSignal): Promise<void>;
}

export interface TddRunnerDeps {
  runCommand: (command: string, cwd?: string) => Promise<CommandResult>;
  subAgentsStore: { list(): Promise<{ name: string }[]> };
  dispatcher: TddDispatcher;       // DispatchService satisfies this
  createSession: () => Promise<string>;
}
```

`DispatchService.handle(rawBody, sse, signal)` accepts `{ sessionId, message }` and ignores
extra fields — it satisfies `TddDispatcher` with no change (same as swarms).

### Default `runCommand`

Wraps `executeCommand` from `server/mcp/builtin/aether-shell.handler.ts` (cap 120s). That
handler returns text formatted `…stdout…\n---\n…stderr…\n---\nexit code: N`. The default
`runCommand` runs it, parses the trailing `exit code: (\d+)` to get `exitCode` (treating a
missing/unparseable code or a thrown error as a non-zero failure), and returns the full text
as `output`. Constructed in `index.ts`.

### Loop (`runTddLoop(deps, opts, sse, signal)`)

1. `maxRetries = opts.maxRetries ?? 5`.
2. Validate `opts.subAgentName` against `deps.subAgentsStore.list()` names; if missing →
   `sse.event('tdd_error', { message: 'unknown sub-agent: …' })` + `tdd_done {status:'error'}`,
   `end()`, return.
3. `tdd_started { command, subAgentName, maxRetries }`.
4. `let res = await deps.runCommand(opts.command, opts.cwd);`
   `tdd_test_result { iteration: 0, exitCode: res.exitCode, passed: res.exitCode === 0, output: tail(res.output) }`.
   If `res.exitCode === 0` → `tdd_done {status:'already_green', iterations: 0}`, `end()`, return.
5. `const sessionId = await deps.createSession();`
6. For `iteration` 1..maxRetries:
   - if `signal.aborted` → `tdd_done {status:'interrupted'}`, `end()`, return.
   - `tdd_iteration_started { iteration }`.
   - `const message = framing(opts.command, res.output);` (see below)
   - `const collector = createCollectingSse(sse);`
     `await deps.dispatcher.handle({ sessionId, message: \`@${opts.subAgentName} ${message}\` }, collector, signal);`
   - if `collector.capturedError()` → `tdd_error {iteration, message}` + `tdd_done {status:'error'}`,
     `end()`, return.
   - `res = await deps.runCommand(opts.command, opts.cwd);`
     `tdd_test_result { iteration, exitCode: res.exitCode, passed: res.exitCode === 0, output: tail(res.output) }`.
   - if `res.exitCode === 0` → `tdd_done {status:'success', iterations: iteration}`, `end()`, return.
7. `tdd_done {status:'max_retries_exceeded', iterations: maxRetries}`, `end()`.

**Framing prompt:**
```
The test command `${command}` is failing. Its output:

```
${tail(output)}
```

Fix the code so the tests pass. Use your tools to read and edit the relevant files.
Do not edit the tests unless they are clearly wrong.
```

**`tail(output)`** keeps the last ~8000 characters (failures are typically at the end),
prefixed with a `…(truncated)` marker when it cuts.

## API & SSE

`server/routes/tdd.routes.ts` → `createTddRoutes(deps: TddRunnerDeps)`:
- `POST /api/tdd/run` (body `{ command, subAgentName, maxRetries?, cwd? }`), validated by a
  zod schema. `createSseEmitter(res)`; `res.on('close')` aborts the signal; calls
  `runTddLoop`; route-level try/catch emits `tdd_error` + `tdd_done {error}` on an unexpected throw.

Wiring: mount in `app.ts` when `deps.tddRunnerDeps` is present; construct the deps in
`index.ts` (default `runCommand` over `executeCommand`, plus `subAgentsStore`, `dispatcher`,
`createSession: async () => (await historyStore.createEmpty()).id`).

### SSE event vocabulary

`tdd_started`, `tdd_iteration_started`, `tdd_test_result`, `tdd_error`, `tdd_done` — plus the
forwarded per-agent events (`text`, `thinking`, `reasoning_step`, `tool_call_*`).

## Frontend

```
src/lib/api/tdd.api.ts              # run() → SSE (POST /api/tdd/run)
src/hooks/useTddRun.ts              # consume SSE (reuse parseSseStream), expose iterations/status
src/components/tdd/TddRunModal.tsx  # command input + sub-agent <select> (from useSubAgentsStore) + maxRetries
src/components/tdd/TddRunPanel.tsx  # live iterations: each test result (pass/fail + output tail) + final status
src/hooks/useCommands.ts            # add "Auto-fix tests…" palette command (group 'ui') that opens TddRunModal
```
- The palette command opens `TddRunModal`; on submit it mounts `TddRunPanel` which calls
  `useTddRun().run(opts)`.
- The sub-agent `<select>` is populated from `useSubAgentsStore().list`; if empty, the modal
  shows a hint to create a sub-agent first.

## Error handling

- Unknown sub-agent → fail-fast `tdd_error` + `tdd_done {error}`.
- Fixer turn emits an `error` event (dispatch does not throw) → caught via
  `collector.capturedError()` → `tdd_error` + `tdd_done {error}`.
- Command timeout (executeCommand ≥120s) → returned as a non-zero `CommandResult` with the
  timeout text in `output`; treated as a normal failing iteration.
- Client disconnect → `res.on('close')` aborts → `tdd_done {interrupted}` (checked at loop top).
- `maxRetries` exhausted → `tdd_done {max_retries_exceeded}`.

## Testing

- `tdd.runner.test.ts` (fake `runCommand`/`dispatcher`/`createSession`/`subAgentsStore`):
  already-green (exit 0 first, no fixer turn); red→green at iteration 1 (exit 1 then 0);
  `max_retries_exceeded` runs exactly `maxRetries` fixer turns; unknown sub-agent fails fast;
  fixer `capturedError` → `tdd_error`; pre-aborted signal → `interrupted`; the fixer message
  contains the failing output and the `@subAgentName` mention.
- `tdd.routes.test.ts`: `POST /api/tdd/run` SSE smoke with a fake runner; zod validation (400-equivalent
  via an `tdd_error`/`tdd_done` terminal pair, matching the swarm run-route convention).
- `runCommand` default: a small unit verifying exit-code extraction from the shell handler's
  text format (`exit code: 0` → 0; non-zero; unparseable → non-zero).
- `collecting-sse.test.ts`: moves with the file; still passes from `server/lib/`.
- Frontend: `useTddRun` reducer (or a store) test mapping `tdd_*` events to view state.
- Coverage: `server/domain/tdd/**` and `server/lib/**` meet the 80% thresholds.

## Final code review (required closing step)

After all tasks are implemented and the suite is green, the slice ends with a
**final, adversarial code review of the whole branch diff** (`main..HEAD`) before the
PR is merged — not just the per-task reviews. The reviewer reads the actual code
(does not trust task reports) and focuses on:

- **Loop correctness & safety:** abort propagation into `runCommand` and the fixer
  turn; that a never-passing command stops exactly at `maxRetries`; that
  `collector.capturedError()` reliably ends the run; no unbounded waits or leaked
  child processes from `executeCommand`.
- **Command execution:** exit-code extraction is robust (missing/garbled code → treated
  as failure); the configurable `command` is passed to the shell as the user intends
  (note: it is intentionally user-supplied and runs with `shell: true` — call out any
  surprising shell-injection surface beyond that expected behavior).
- **Output handling:** `tail()` truncation never sends an unbounded prompt; no secret
  leakage beyond what the test output already contains.
- **SSE/stream:** the run route aborts on client close, the terminal `tdd_done` always
  fires, and forwarded per-agent events don't prematurely close the stream.
- **Shared refactor:** the `collecting-sse` move left no stale imports and swarms still pass.

Findings are fixed (and re-reviewed) before merge. This is in addition to the standard
spec-compliance + code-quality reviews per task.

## Out of scope (future)

- Structured/JSON test-result parsing and per-failure UI.
- Playwright / multi-runner orchestration.
- "No-progress" detection (identical-failures fingerprint) and adaptive retry strategies.
- Persisted run history / re-run.
- Auto-committing the fix (belongs to a future git-integration slice).
