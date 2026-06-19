# Per-step / per-sub-agent LLM selection for swarms — Design

**Date:** 2026-06-19
**Status:** approved (design), pending implementation plan

## Goal

Let a swarm run its steps on **different LLMs**. Today every step of a swarm
runs on a single provider — the registry default — because sub-agents carry no
model and swarm steps carry no provider (the shared session is created empty, so
`DispatchService` resolution falls through `requested ?? session ?? default` to
the default). This adds a **hybrid** model binding:

- each **sub-agent** gains an optional default `model`;
- each **swarm step** gains an optional `providerName` override.

Resolution per step: `step.providerName ?? subAgent.model ?? session ?? default`.

`providerName`/`model` values are registry keys in `transport:model` form
(e.g. `anthropic:claude-opus-4-7`), the same strings `DispatchService` already
accepts as a per-request override.

## Scope decisions (from brainstorming)

- **Binding:** hybrid — sub-agent default model, overridable per step.
- **Unavailable model at run time:** fallback down the resolution chain **plus**
  a `swarm_step_warning` SSE event (not fail-fast; not silent).
- **Breadth:** full-stack (migration + backend + API/schema + UI).
- **Where resolution lives (Approach 3 — split by responsibility):**
  - **Dispatch** extends only the resolution *chain* so `subAgent.model` is
    honored everywhere (including a direct `@mention` in chat), keeping its
    existing hard-error when the final provider is unavailable.
  - **Orchestrator** pre-resolves `step.providerName ?? subAgent.model` per step,
    checks availability against the registry, and on a miss substitutes the
    default and emits `swarm_step_warning`. It therefore always hands dispatch a
    concrete, available provider — so dispatch never hits its hard-error in the
    swarm path.

## Data model

New append-only migration `server/db/migrations/016_swarm_step_provider.sql`
(latest existing is `015_skill_state.sql`):

```sql
ALTER TABLE swarm_steps ADD COLUMN provider_name TEXT;   -- nullable = "inherit"
ALTER TABLE subagents   ADD COLUMN model TEXT;           -- nullable = "no default"
```

Both columns nullable → fully backward-compatible: existing swarms and
sub-agents keep their current single-default-provider behavior until a model is
set. `provider_name`/`model` are free-text registry keys, not foreign keys
(providers are dynamic and machine-dependent); validity is handled at run time,
not by the schema.

## Backend changes

### Types

- `swarm.types.ts`: `SwarmStep += providerName?: string`.
- `subagents.types.ts`: `SubAgentRecord += model?: string` and
  `SubAgentMeta += model?: string` (so `list()` carries it for the orchestrator).

### Schemas (zod)

- `swarm.schema.ts`: `SwarmStepSchema += providerName: z.string().max(120).optional()`.
- `subagents.schema.ts`: add `model: z.string().max(120).optional()` to
  `SubAgentRecordSchema`, `SubAgentCreateInputSchema`, `SubAgentUpdateInputSchema`.

### Stores

- `swarm.store.ts`: read/write `provider_name` on steps (create, update, read);
  map row `provider_name` → `step.providerName` (and `null` → `undefined`).
- `subagents.store.ts`: read/write `model` on the `subagents` row; `null` →
  `undefined`.

### Dispatch (`dispatch.service.ts`) — minimal change

In `handle()`, after `matchedSubAgent` is resolved, extend the existing chain:

```ts
const providerName =
  requestedName ?? matchedSubAgent?.model ?? sessionName ?? fallbackName;
```

No change to error semantics: a resolved-but-unavailable provider still emits the
existing hard error. `resume()` does not resolve sub-agents and is left
unchanged.

### Orchestrator (`swarm.orchestrator.ts`)

- `SwarmOrchestratorDeps` gains
  `providers: { isAvailable(name: string): boolean; defaultName(): string | undefined }`
  — a thin adapter over `ProviderRegistry` (`isAvailable = !!registry.get(name)`,
  `defaultName = registry.defaultName()`).
- The run start already validates step sub-agent names against
  `subAgentsStore.list()`. Extend `SubAgentMeta` and the `list()` SQL to include
  `model`, and build the `name → model` map from that single `list()` call (no
  per-record reads). This is the orchestrator's only source for each step's
  sub-agent default.
- Per step, before dispatch:
  ```ts
  const requested = step.providerName ?? subAgentModel[step.subAgentName]; // may be undefined
  let effective: string | undefined = requested;
  if (requested && !deps.providers.isAvailable(requested)) {
    effective = deps.providers.defaultName();
    sse.event('swarm_step_warning', { position: i, requested, used: effective });
  }
  await deps.dispatcher.handle(
    { sessionId, message: `@${step.subAgentName} ${message}`, providerName: effective },
    collector, signal,
  );
  ```
  - `requested` set and available → pass it.
  - `requested` set and unavailable → pass the default, emit `swarm_step_warning`.
  - `requested` unset → pass `undefined` (dispatch resolves session/default), no
    warning.
- `SwarmDispatcher` interface widens to accept `providerName?: string`
  (`DispatchRequestSchema` already accepts it at runtime).

## API & SSE

- No new routes. CRUD already round-trips the full step/sub-agent payloads; the
  new fields flow through the existing `POST/PUT /api/swarms` and
  `POST/PUT /api/subagents` once schema + store are updated.
- New swarm-level SSE event: `swarm_step_warning { position, requested, used }`,
  forwarded like the other swarm events.

## Frontend (full-stack)

- `src/components/swarms/StepsListEditor.tsx`: per step, a model `<select>`
  populated from `useProvidersStore().list`, with an empty "Inherit (sub-agent
  default / session)" option mapping to `providerName: undefined`.
- Sub-agent editor: a "Default model" `<select>` (with a "None" option →
  `model: undefined`).
- `src/components/swarms/SwarmRunPanel.tsx`: show the effective model per step and
  a visible notice on `swarm_step_warning` ("requested X, used Y").
- `src/hooks/useSwarmRun.ts`: reduce `swarm_step_warning` into a per-step
  `warning?: { requested, used }` field on `SwarmStepView`.
- The `<select>`s list currently-available providers but **preserve a persisted
  value even when not currently available** (cross-device: a model configured on
  one machine may be absent on another — show it as unavailable; the runtime
  fallback+warning handles the actual run).
- i18n strings added to `src/i18n/`.

## Error handling

- Requested model unavailable → fallback to default + `swarm_step_warning`.
- No provider available at all (`defaultName()` undefined) → dispatch emits its
  existing "No provider available" error → captured by `collecting-sse` →
  `swarm_error` + `swarm_done {error}` (existing behavior).
- Unknown sub-agent name → existing fail-fast at run start, unchanged.

## Testing

- `swarm.store.test.ts`: round-trip `providerName` on steps, including
  absent/`null`.
- `subagents.store.test.ts`: round-trip `model`, including absent/`null`.
- `dispatch.service.test.ts`: `subAgent.model` used when no `requestedName`;
  `requestedName` takes precedence over `subAgent.model`.
- `swarm.orchestrator.test.ts` (fake `dispatcher` + fake `providers`):
  step override beats sub-agent default; available requested → passed through;
  unavailable requested → default substituted and `swarm_step_warning` emitted;
  unrequested → no warning and `providerName` undefined; the provider handed to
  `dispatcher.handle` is always available.
- Frontend: `useSwarmRun` reduces `swarm_step_warning`; `swarms.store` round-trips
  `providerName`.
- Coverage: new code falls under existing `server/domain/**` and `src/stores/**`
  80% thresholds.

## Out of scope (future)

- Per-step thinking / temperature / other generation params.
- Non-linear topologies (DAG / branching / parallel).
- Persisted run history.
- Preventive cross-device model validation (handled at run time by the fallback).
