# Slice 25 — Multi-Agent Swarms (Workflow DSL) — Design

**Branch:** `feat/slice-25-swarms`
**Date:** 2026-05-29
**Status:** approved (design), pending implementation plan

## Goal

Let a user define a **swarm**: an ordered, linear sequence of sub-agent invocations
(e.g. `architect → coder → qa`) where each step's text output becomes the next step's
input. The orchestrator runs the steps server-side, streams progress as SSE, persists
the conversation in a chat session (visible in the web UI), and can pause for human
approval after configured steps.

Reuses Slice 6/9 sub-agents as the step primitives and the existing dispatch loop
(including Slice 22 per-tool breakpoints, which keep working inside each turn).

## Scope decisions (from brainstorming)

- **Definition format:** structured, GUI-edited, stored relationally in SQLite (like
  sub-agents). No YAML parser.
- **Topology:** linear sequence only (no parallel/branching in v1).
- **Human-in-the-loop:** configurable **per step** — each step carries a `pauseAfter`
  flag. When set, the run pauses after that step for an approve/reject decision.
- **Data flow:** a step's input is the previous step's final text, optionally prefixed
  by that step's fixed `promptTemplate` (`promptTemplate ? template + "\n\n" + incoming
  : incoming`). Step 0's input is the run's initial `input`.
- **Runs are ephemeral:** no run/run-step tables. A run lives on the open SSE
  connection; the transcript is the chat session (history + reasoning steps already
  persisted per turn by dispatch). Closing the connection aborts the run.
- **One new session per run**, titled after the swarm, so the transcript is visible in
  the web UI without polluting an existing chat.

## Data model

New migration `server/db/migrations/011_swarms.sql` (latest existing is 010):

```sql
CREATE TABLE swarms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE swarm_steps (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  subagent_name TEXT NOT NULL,
  prompt_template TEXT NOT NULL DEFAULT '',
  pause_after INTEGER NOT NULL DEFAULT 0,  -- 0/1 boolean
  UNIQUE (swarm_id, position)
);
CREATE INDEX idx_swarm_steps_swarm ON swarm_steps(swarm_id, position);
```

`subagent_name` references a sub-agent by name (not a FK — sub-agents are addressed by
name via `@mention`, and a name may be (re)created later). Missing names are validated
at run start, not by the schema.

## Backend architecture

```
server/domain/swarms/
  swarm.types.ts          # SwarmRecord, SwarmStep, SwarmMeta, SwarmRunEvent, SwarmRunStatus
  swarm.schema.ts         # zod: SwarmCreateInput / SwarmUpdateInput (name + steps[])
  swarm.store.ts          # CRUD for swarms + ordered steps (relational, cascade)
  swarm.approval.ts       # SwarmApprovalRegistry: awaitDecision(id, timeoutMs) / resolveDecision(id, action)
  collecting-sse.ts       # SseEmitter adapter: capture 'text' chunks; forward all events (wrapped) to outer SSE
  swarm.orchestrator.ts   # runSwarm(deps, opts, sse, signal): the linear loop
server/routes/swarms.routes.ts   # CRUD + POST /:id/run (SSE) + POST /decision
```

### Types (key shapes)

```ts
interface SwarmStep {
  subAgentName: string;
  promptTemplate: string; // '' = none
  pauseAfter: boolean;
}
interface SwarmRecord { id: string; name: string; steps: SwarmStep[]; createdAt: number; updatedAt: number; }
interface SwarmMeta { id: string; name: string; stepCount: number; createdAt: number; updatedAt: number; }

type SwarmRunStatus = 'done' | 'rejected' | 'error' | 'interrupted';
```

### Orchestrator (testable via injected deps)

```ts
interface SwarmDispatcher {
  handle(body: { sessionId: string; message: string }, sse: SseEmitter, signal: AbortSignal): Promise<void>;
}
interface SwarmOrchestratorDeps {
  store: Pick<SwarmStore, 'read'>;
  subAgentsStore: Pick<SubAgentsStore, 'list'>;   // to validate step names exist
  dispatcher: SwarmDispatcher;                    // DispatchService satisfies this
  createSession: (title: string) => Promise<string>;  // HistoryStore.createEmpty wrapper → session id
  approvals: SwarmApprovalRegistry;
  approvalTimeoutMs?: number;                     // default 300_000
}
```

`DispatchService` already matches `SwarmDispatcher` (its `handle(rawBody, sse, signal)`
accepts `{ sessionId, message }` and ignores extra fields). No dispatch change needed.

**`runSwarm(deps, { swarmId, input }, sse, signal)`:**
1. `read(swarmId)` → 404-style error event if absent.
2. Validate every `step.subAgentName` against `subAgentsStore.list()` names; if any
   missing → `sse.event('swarm_error', { message: 'unknown sub-agent: <name>' })` +
   `swarm_done {status:'error'}`, return.
3. `sessionId = await createSession(swarm.name)`; emit `swarm_started {sessionId, swarmName, stepCount}`.
4. `let incoming = input;`
   For each `step` at `position i`:
   - `swarm_step_started {position: i, subAgent: step.subAgentName}`
   - `const message = step.promptTemplate ? \`${step.promptTemplate}\n\n${incoming}\` : incoming;`
   - `const collector = createCollectingSse(sse);` (forwards wrapped events to outer SSE, accumulates text)
   - `await deps.dispatcher.handle({ sessionId, message: \`@${step.subAgentName} ${message}\` }, collector, signal);`
   - if `collector.capturedError()` is non-null (dispatch emitted an `error` event — it
     does NOT throw): `swarm_error {position, message}` + `swarm_done {status:'error'}`, return.
   - `incoming = collector.text();` (the step output)
   - `swarm_step_completed {position: i, output: incoming}`
   - if `step.pauseAfter`: `const approvalId = \`${swarmId}:${i}\`; sse.event('swarm_approval_request', {approvalId, position:i, output: incoming});`
     `const action = await deps.approvals.awaitDecision(approvalId, timeout).catch(() => 'reject');`
     if `'reject'` → `swarm_done {status:'rejected', stoppedAt:i}`, return.
   - if `signal.aborted` → `swarm_done {status:'interrupted'}`, return.
5. `swarm_done {status:'done', finalOutput: incoming}`.

Errors thrown by `dispatcher.handle` are caught per step → `swarm_error {position, message}`
+ `swarm_done {status:'error'}`, return.

### Collecting SSE (`collecting-sse.ts`)

```ts
function createCollectingSse(outer: SseEmitter): SseEmitter & {
  text(): string;
  capturedError(): { message: string; retryable: boolean } | null;
}
```
- `event(name, data)`: if `name === 'text'`, append `data.chunk` to an internal buffer;
  if `name === 'error'`, record `{message, retryable}` (dispatch emits failures as an
  `error` event, not a throw); forward EVERY event EXCEPT `'done'` to `outer` unchanged
  (so the UI sees streaming text, thinking, reasoning steps, and per-tool gate requests).
  Swallow the inner `'done'` — the swarm emits its own step/run completion.
- `error(message, retryable)` (the `SseEmitter.error` method): record the error and
  forward it as `event('error', …)` to `outer`, but do NOT close the outer stream.
- `end()`: no-op (the inner turn ending must not close the swarm stream).
- `text()`: returns the accumulated text buffer.
- `capturedError()` (the accessor): returns the recorded error, or `null` if the turn
  produced none. The orchestrator checks this after each `handle` to decide whether to stop.

This is the crux: it lets the orchestrator reuse the SSE-bound dispatch loop while
(a) capturing each turn's output and (b) keeping the swarm stream open across turns.

### Approval registry (`swarm.approval.ts`)

Mirrors `mcpRegistry.awaitDecision/resolveDecision`:
```ts
class SwarmApprovalRegistry {
  awaitDecision(id: string, timeoutMs: number): Promise<'approve' | 'reject'>; // rejects/resolves 'reject' on timeout
  resolveDecision(id: string, action: 'approve' | 'reject'): void;             // no-op if no waiter
}
```
In-memory `Map<string, {resolve, timer}>`. On timeout, resolve `'reject'` and delete.

## API & SSE

`server/routes/swarms.routes.ts` (`createSwarmRoutes(store, orchestratorDeps)`):
- `GET /api/swarms` → `SwarmMeta[]`
- `POST /api/swarms` (body `{name, steps}`) → 201 `SwarmMeta`
- `GET /api/swarms/:id` → `SwarmRecord`
- `PUT /api/swarms/:id` (body `{name?, steps?}`) → `SwarmMeta`
- `DELETE /api/swarms/:id` → 204
- `POST /api/swarms/:id/run` (body `{input}`) → SSE stream (`createSseEmitter(res)`),
  calls `runSwarm`; `res.on('close')` aborts the signal.
- `POST /api/swarms/decision` (body `{approvalId, action}`) → resolves the gate, `{ ok: true }`.

Per-tool gates inside a turn keep using `POST /api/mcp/decision` (callId); the
orchestrator forwards `tool_call_request` events so the UI can respond.

Wiring: mount in `server/app.ts` only when the swarm deps are present; construct the
store + approval registry + orchestrator deps in `server/index.ts` (reusing the existing
`historyStore`, `subAgentsStore`, `dispatcher`).

### SSE event vocabulary (swarm-level)

`swarm_started`, `swarm_step_started`, `swarm_step_completed`, `swarm_approval_request`,
`swarm_error`, `swarm_done` — plus the forwarded per-agent events (`text`, `thinking`,
`reasoning_step`, `tool_call_request`, `tool_call_started`, `tool_call_progress`,
`tool_call_result`).

## Frontend

```
src/lib/api/swarms.api.ts          # CRUD + run() returning a fetch SSE stream
src/stores/swarms.store.ts         # list/create/update/delete (optimistic update + rollback, existing pattern)
src/components/swarms/SwarmEditModal.tsx   # name + ordered StepsListEditor
src/components/swarms/StepsListEditor.tsx  # add/remove/reorder steps; per-step: subagent <select>, promptTemplate <textarea>, pauseAfter <toggle>
src/components/swarms/SwarmRunPanel.tsx    # input box, live progress (per step), Approve/Reject buttons on swarm_approval_request
src/components/sidebar/SwarmsSection.tsx   # list swarms (mirrors SubAgentsSection)
src/hooks/useSwarmRun.ts                   # consume the run SSE (reuse src/lib/sse-parser.ts), expose steps/status/approve/reject
```
- `App.tsx` calls `useSwarmsStore().init()` on mount; `SwarmsSection` added to the sidebar.
- The subagent `<select>` in the editor is populated from `useSubAgentsStore().list`.
- i18n strings added to `src/i18n/`.

## Error handling

- Unknown sub-agent name at run start → fail-fast `swarm_error` + `swarm_done {error}`.
- A step's dispatch throws → `swarm_error {position}` + `swarm_done {error}`, stop.
- Approval timeout (default 5 min) → treated as reject → `swarm_done {rejected}`.
- Client disconnect → `res.on('close')` aborts → `swarm_done {interrupted}` (best effort).
- Empty swarm (no steps) → `swarm_error` at run start.

## Testing

- `swarm.store.test.ts`: create/read/update/delete; steps stored and returned in
  `position` order; cascade delete of steps; update replaces steps atomically.
- `swarm.approval.test.ts`: `awaitDecision` resolves on `resolveDecision`; times out to
  `'reject'`; `resolveDecision` for an unknown id is a no-op.
- `collecting-sse.test.ts`: accumulates `text` chunks into `text()`; forwards non-`done`
  events to the outer emitter; swallows `done`; `end()` does not close outer.
- `swarm.orchestrator.test.ts` (fake `dispatcher`/`createSession`/`approvals`): steps run
  in order; step N's input is step N-1's output with the template prefix; `pauseAfter`
  triggers an `awaitDecision` and `reject` stops the run while `approve` continues;
  unknown sub-agent fails fast; empty swarm errors; final `swarm_done {done}` carries the
  last output; a dispatcher throw yields `swarm_error`.
- `swarms.routes.test.ts`: CRUD happy paths + validation errors; `POST /:id/run` SSE smoke
  with a fake orchestrator; `POST /decision` resolves a pending approval.
- Frontend: `swarms.store.test.ts` (optimistic update + rollback on API error).
- Coverage: new `server/domain/swarms/**` falls under the existing `server/domain/**` 80%
  threshold; `src/stores/**` already enforced.

## Out of scope (future slices)

- Parallel / branching / conditional topologies (DAG).
- Named output variables / templating engine (`{{architect.output}}`).
- Persisted run history / run replay (runs are ephemeral in v1).
- YAML import/export of swarm definitions.
- Re-running a swarm against an existing session (v1 always creates a new session).
