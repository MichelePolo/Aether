# Per-step / per-sub-agent LLM selection for swarms — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a swarm run each step on a different LLM via a hybrid binding — an optional per-sub-agent default `model` plus an optional per-step `providerName` override — with graceful fallback + warning when a requested model is unavailable.

**Architecture:** Approach 3 (split by responsibility). `DispatchService` extends only its provider-resolution chain so a sub-agent's `model` is honored everywhere (chat `@mention` included). The swarm orchestrator pre-resolves `step.providerName ?? subAgent.model` per step, checks availability against the `ProviderRegistry`, substitutes the default + emits `swarm_step_warning` on a miss, and always hands dispatch a concrete available provider.

**Tech Stack:** TypeScript (strict), Express, better-sqlite3 (synchronous), Zod, React 19 + Zustand, Tailwind v4, Vitest (two projects: `backend` node, `frontend` jsdom).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-19-swarm-per-step-llm-design.md`.
- Provider identifiers are registry keys in `transport:model` form (e.g. `anthropic:claude-opus-4-7`).
- New DB columns are **nullable** and added via a **new append-only** migration; never edit an existing migration.
- Import paths use the `@/` root alias (e.g. `@/server/domain/...`, `@/src/stores/...`).
- `npm run lint` is `tsc --noEmit` and MUST pass; TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`.
- Vitest `globals` are on — do NOT import `describe/it/expect`.
- Run focused backend tests with `npx vitest run --project backend <file>`; frontend with `--project frontend`.
- Coverage thresholds (80%) apply to `server/domain/**`, `server/lib/**`, `src/hooks/**`, `src/stores/**`, `src/lib/**`.
- `registry.defaultName()` returns `string | null`; `registry.get(name)` returns `AIProvider | null`.

---

### Task 1: Migration + swarm step `providerName` (types, schema, store)

**Files:**
- Create: `server/db/migrations/016_swarm_step_provider.sql`
- Modify: `server/domain/swarms/swarm.types.ts`
- Modify: `server/domain/swarms/swarm.schema.ts`
- Modify: `server/domain/swarms/swarm.store.ts`
- Test: `server/domain/swarms/swarm.store.test.ts`

**Interfaces:**
- Produces: `SwarmStep.providerName?: string`; `swarm_steps.provider_name` column; `subagents.model` column (created here, consumed by Task 2).

- [ ] **Step 1: Write the migration**

Create `server/db/migrations/016_swarm_step_provider.sql`:

```sql
-- Per-step LLM selection for swarms: a step may pin a provider (transport:model
-- registry key); a sub-agent may carry a default model. Both nullable = inherit /
-- no default, so existing rows keep the single-default-provider behavior.
ALTER TABLE swarm_steps ADD COLUMN provider_name TEXT;
ALTER TABLE subagents   ADD COLUMN model TEXT;
```

- [ ] **Step 2: Extend the `SwarmStep` type**

In `server/domain/swarms/swarm.types.ts`, change the `SwarmStep` interface:

```ts
export interface SwarmStep {
  subAgentName: string;
  promptTemplate: string;
  pauseAfter: boolean;
  /** Optional provider override (transport:model). Undefined = inherit. */
  providerName?: string;
}
```

- [ ] **Step 3: Extend the step schema**

In `server/domain/swarms/swarm.schema.ts`, update `SwarmStepSchema`:

```ts
export const SwarmStepSchema = z.object({
  subAgentName: z.string().min(1).max(80),
  promptTemplate: z.string().max(8000).default(''),
  pauseAfter: z.boolean().default(false),
  providerName: z.string().max(120).optional(),
});
```

- [ ] **Step 4: Write the failing store round-trip test**

Add to `server/domain/swarms/swarm.store.test.ts` (mirror the existing setup that constructs a `SwarmStore` over a migrated in-memory DB):

```ts
it('round-trips a step providerName, omitting it when unset', async () => {
  const meta = await store.create({
    name: 'mixed',
    steps: [
      { subAgentName: 'architect', promptTemplate: '', pauseAfter: false, providerName: 'anthropic:claude-opus-4-7' },
      { subAgentName: 'coder', promptTemplate: '', pauseAfter: false },
    ],
  });
  const rec = await store.read(meta.id);
  expect(rec?.steps[0].providerName).toBe('anthropic:claude-opus-4-7');
  expect(rec?.steps[1].providerName).toBeUndefined();
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run --project backend server/domain/swarms/swarm.store.test.ts -t "round-trips a step providerName"`
Expected: FAIL (providerName is `undefined` because the store does not read/write the column yet).

- [ ] **Step 6: Read & write `provider_name` in the store**

In `server/domain/swarms/swarm.store.ts`:

Change the `StepRow` type:
```ts
type StepRow = { position: number; subagent_name: string; prompt_template: string; pause_after: number; provider_name: string | null };
```

In `read()`, update the SELECT and mapper:
```ts
const steps = (
  this.db
    .prepare(
      'SELECT position, subagent_name, prompt_template, pause_after, provider_name FROM swarm_steps WHERE swarm_id = ? ORDER BY position',
    )
    .all(id) as StepRow[]
).map((s): SwarmStep => ({
  subAgentName: s.subagent_name,
  promptTemplate: s.prompt_template,
  pauseAfter: s.pause_after === 1,
  ...(s.provider_name ? { providerName: s.provider_name } : {}),
}));
```

In `writeSteps()`, update the INSERT:
```ts
private writeSteps(id: string, steps: SwarmStep[]): void {
  this.db.prepare('DELETE FROM swarm_steps WHERE swarm_id = ?').run(id);
  const insert = this.db.prepare(
    'INSERT INTO swarm_steps (id, swarm_id, position, subagent_name, prompt_template, pause_after, provider_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  steps.forEach((s, i) =>
    insert.run(randomUUID(), id, i, s.subAgentName, s.promptTemplate ?? '', s.pauseAfter ? 1 : 0, s.providerName ?? null),
  );
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run --project backend server/domain/swarms/swarm.store.test.ts`
Expected: PASS (all swarm store tests).

- [ ] **Step 8: Commit**

```bash
git add server/db/migrations/016_swarm_step_provider.sql server/domain/swarms/swarm.types.ts server/domain/swarms/swarm.schema.ts server/domain/swarms/swarm.store.ts server/domain/swarms/swarm.store.test.ts
git commit -m "feat(swarms): persist per-step providerName (migration 016)"
```

---

### Task 2: Sub-agent default `model` (types, schema, store, list)

**Files:**
- Modify: `server/domain/subagents/subagents.types.ts`
- Modify: `server/domain/subagents/subagents.schema.ts`
- Modify: `server/domain/subagents/subagents.store.ts`
- Test: `server/domain/subagents/subagents.store.test.ts`

**Interfaces:**
- Consumes: `subagents.model` column (Task 1).
- Produces: `SubAgentRecord.model?: string`; `SubAgentMeta.model?: string` (returned by `list()` and `read()`); accepted by `create`/`update`.

- [ ] **Step 1: Extend the types**

In `server/domain/subagents/subagents.types.ts`:

```ts
export interface SubAgentRecord {
  name: string;
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  /** Optional default provider (transport:model). Undefined = no default. */
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SubAgentMeta {
  id: string;
  name: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Extend the schemas**

In `server/domain/subagents/subagents.schema.ts`, add `model` to `SubAgentRecordSchema` and `SubAgentCreateInputSchema` (the update schema is `.partial()` of create, so it inherits it):

```ts
export const SubAgentRecordSchema = z.object({
  name: SubAgentStoredNameSchema,
  systemInstruction: z.string().max(8000),
  skills: z.array(z.string()).max(50),
  tools: z.array(ToolSchema).max(50),
  model: z.string().max(120).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const SubAgentCreateInputSchema = z.object({
  name: SubAgentNameSchema,
  systemInstruction: z.string().max(8000).default(''),
  skills: z.array(z.string()).max(50).default([]),
  tools: z.array(ToolSchema).max(50).default([]),
  model: z.string().max(120).optional(),
});
```

- [ ] **Step 3: Write the failing store test**

Add to `server/domain/subagents/subagents.store.test.ts`:

```ts
it('round-trips a sub-agent model and exposes it via list()', async () => {
  const meta = await store.create({ name: 'planner', model: 'gemini:gemini-1.5-pro' });
  expect(meta.model).toBe('gemini:gemini-1.5-pro');

  const rec = await store.read(meta.id);
  expect(rec?.model).toBe('gemini:gemini-1.5-pro');

  const listed = (await store.list()).find((m) => m.id === meta.id);
  expect(listed?.model).toBe('gemini:gemini-1.5-pro');

  const noModel = await store.create({ name: 'plain' });
  expect((await store.read(noModel.id))?.model).toBeUndefined();
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run --project backend server/domain/subagents/subagents.store.test.ts -t "round-trips a sub-agent model"`
Expected: FAIL (`model` is undefined / `create` ignores it).

- [ ] **Step 5: Implement model persistence**

In `server/domain/subagents/subagents.store.ts`:

Add `model` to the `CreateInput` interface and the `SubAgentRow` type:
```ts
interface CreateInput {
  name: string;
  systemInstruction?: string;
  skills?: string[];
  tools?: Tool[];
  model?: string;
}

type SubAgentRow = {
  id: string;
  name: string;
  system_instruction: string;
  model: string | null;
  created_at: number;
  updated_at: number;
};
```

In `list()`, select and map `model`:
```ts
async list(): Promise<SubAgentMeta[]> {
  const rows = this.db
    .prepare('SELECT id, name, model, created_at, updated_at FROM subagents ORDER BY updated_at DESC')
    .all() as { id: string; name: string; model: string | null; created_at: number; updated_at: number }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ...(r.model ? { model: r.model } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
```

In `read()`, select `model` and include it in the returned record:
```ts
const row = this.db
  .prepare(
    'SELECT id, name, system_instruction, model, created_at, updated_at FROM subagents WHERE id = ?',
  )
  .get(id) as SubAgentRow | undefined;
if (!row) return null;
// ...existing skills/tools reads...
return {
  name: row.name,
  systemInstruction: row.system_instruction,
  skills,
  tools,
  ...(row.model ? { model: row.model } : {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
};
```

In `create()`, persist `model`:
```ts
this.db
  .prepare(
    'INSERT INTO subagents (id, name, system_instruction, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  .run(id, uniqueName, input.systemInstruction ?? '', input.model ?? null, now, now);
```

In `update()`, read current `model` and write the patched value (alongside the existing name/system_instruction update):
```ts
const cur = this.db
  .prepare('SELECT name, system_instruction, model FROM subagents WHERE id = ?')
  .get(id) as { name: string; system_instruction: string; model: string | null };

this.db
  .prepare(
    'UPDATE subagents SET name = ?, system_instruction = ?, model = ?, updated_at = ? WHERE id = ?',
  )
  .run(
    patch.name ?? cur.name,
    patch.systemInstruction ?? cur.system_instruction,
    patch.model ?? cur.model,
    now,
    id,
  );
```

Update `metaOf()` to include `model`:
```ts
private metaOf(id: string): SubAgentMeta {
  const row = this.db
    .prepare('SELECT id, name, model, created_at, updated_at FROM subagents WHERE id = ?')
    .get(id) as { id: string; name: string; model: string | null; created_at: number; updated_at: number };
  return {
    id: row.id,
    name: row.name,
    ...(row.model ? { model: row.model } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

Note: the `update()` signature already accepts `Partial<Omit<SubAgentRecord, 'createdAt'>>`, which now includes `model` — no signature change needed.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run --project backend server/domain/subagents/subagents.store.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/domain/subagents/subagents.types.ts server/domain/subagents/subagents.schema.ts server/domain/subagents/subagents.store.ts server/domain/subagents/subagents.store.test.ts
git commit -m "feat(subagents): optional default model on sub-agents"
```

---

### Task 3: Dispatch resolution chain honors `subAgent.model`

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts:380` (provider resolution in `handle()`)
- Test: `server/domain/dispatch/dispatch.service.test.ts`

**Interfaces:**
- Consumes: `matchedSubAgent.model` (Task 2). `matchedSubAgent` is already resolved later in `handle()`; the resolution line must move below it (see Step 3).
- Produces: effective provider precedence `requestedName ?? matchedSubAgent.model ?? sessionName ?? fallbackName`.

- [ ] **Step 1: Write the failing test**

Add to `server/domain/dispatch/dispatch.service.test.ts`. Follow the file's existing harness for building a `DispatchService` with a fake provider registry and a sub-agent store; assert which provider name the registry was asked to `get()`. Concretely:

```ts
it('resolves a sub-agent default model when no providerName is requested', async () => {
  // Arrange: a sub-agent "vision" with model 'gemini:gemini-1.5-pro' exists;
  // the session has no providerName; registry default is 'fake:default'.
  // The message mentions @vision so matchedSubAgent.model should win over the default.
  const gotNames: string[] = [];
  const providers = makeRegistryStub(gotNames); // records every get(name)
  const svc = makeService({ providers, subAgent: { name: 'vision', model: 'gemini:gemini-1.5-pro' } });

  await svc.handle({ sessionId: 's1', message: '@vision describe' }, sse, signal);

  expect(gotNames).toContain('gemini:gemini-1.5-pro');
});

it('lets an explicit providerName override the sub-agent model', async () => {
  const gotNames: string[] = [];
  const providers = makeRegistryStub(gotNames);
  const svc = makeService({ providers, subAgent: { name: 'vision', model: 'gemini:gemini-1.5-pro' } });

  await svc.handle({ sessionId: 's1', message: '@vision describe', providerName: 'anthropic:claude-opus-4-7' }, sse, signal);

  expect(gotNames).toContain('anthropic:claude-opus-4-7');
  expect(gotNames).not.toContain('gemini:gemini-1.5-pro');
});
```

(Reuse the existing helpers in the test file for `makeService`/`sse`/`signal`; `makeRegistryStub` wraps the existing registry fake to push each requested name into `gotNames`. If the file lacks such helpers, add a thin local stub that implements `get(name)`/`defaultName()` and records names.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project backend server/domain/dispatch/dispatch.service.test.ts -t "sub-agent default model"`
Expected: FAIL (the registry is asked for the default/session name, not the sub-agent model).

- [ ] **Step 3: Move and extend the resolution**

In `server/domain/dispatch/dispatch.service.ts`, the current resolution at ~line 376-391 runs BEFORE `matchedSubAgent` is computed (~line 456-460). Move the provider resolution so it runs AFTER `matchedSubAgent` is known, and insert the sub-agent model into the chain. The final resolution becomes:

```ts
const requestedName = parsed.data.providerName;
const sessionName = sessionRecord?.providerName;
const fallbackName = this.deps.providers.defaultName();
const providerName = requestedName ?? matchedSubAgent?.model ?? sessionName ?? fallbackName;
if (!providerName) {
  sse.event('error', { message: 'No provider available', retryable: false });
  sse.end();
  return;
}
const provider = this.deps.providers.get(providerName);
if (!provider) {
  sse.event('error', { message: `Provider '${providerName}' not available`, retryable: false });
  sse.end();
  return;
}
```

Keep `requestedName`/`sessionName`/`fallbackName` declared where needed; only the `providerName` composition and the `get()`/guards move below the `matchedSubAgent` resolution. Leave `prior`/context reads where they are.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project backend server/domain/dispatch/dispatch.service.test.ts`
Expected: PASS (new tests + existing dispatch tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "feat(dispatch): resolve sub-agent default model in provider chain"
```

---

### Task 4: Orchestrator per-step resolution + `swarm_step_warning` + wiring

**Files:**
- Modify: `server/domain/swarms/swarm.orchestrator.ts`
- Modify: `server/index.ts:218-225` (orchestrator deps: add `providers`)
- Modify: `server/domain/schedules/schedule-runner.ts:135-141` (orchestrator deps: add `providers`)
- Test: `server/domain/swarms/swarm.orchestrator.test.ts`

**Interfaces:**
- Consumes: `step.providerName` (Task 1), sub-agent `model` via `subAgentsStore.list()` (Task 2), dispatch per-request `providerName` (Task 3).
- Produces: `SwarmOrchestratorDeps.providers: { isAvailable(name: string): boolean; defaultName(): string | null }`; `SwarmDispatcher.handle` accepts `providerName?: string`; new SSE event `swarm_step_warning { position, requested, used }`.

- [ ] **Step 1: Write the failing orchestrator tests**

Add to `server/domain/swarms/swarm.orchestrator.test.ts` (reuse the file's fake `dispatcher`/`createSession`/`approvals`; the fake dispatcher should record the `providerName` it received per call):

```ts
it('passes the step providerName when available', async () => {
  const seen: Array<string | undefined> = [];
  const deps = makeDeps({
    steps: [{ subAgentName: 'a', promptTemplate: '', pauseAfter: false, providerName: 'anthropic:claude-opus-4-7' }],
    subAgents: [{ name: 'a' }],
    providers: { isAvailable: (n) => n === 'anthropic:claude-opus-4-7', defaultName: () => 'fake:default' },
    onHandle: (body) => seen.push(body.providerName),
  });
  await runSwarm(deps, { swarmId: 'sw', input: 'go' }, sse, signal);
  expect(seen).toEqual(['anthropic:claude-opus-4-7']);
});

it('falls back to default and warns when the requested model is unavailable', async () => {
  const events: Array<{ name: string; data: any }> = recordEvents(sse);
  const seen: Array<string | undefined> = [];
  const deps = makeDeps({
    steps: [{ subAgentName: 'a', promptTemplate: '', pauseAfter: false, providerName: 'openai:gpt-4o' }],
    subAgents: [{ name: 'a' }],
    providers: { isAvailable: () => false, defaultName: () => 'fake:default' },
    onHandle: (body) => seen.push(body.providerName),
  });
  await runSwarm(deps, { swarmId: 'sw', input: 'go' }, sse, signal);
  expect(seen).toEqual(['fake:default']);
  const warn = events.find((e) => e.name === 'swarm_step_warning');
  expect(warn?.data).toMatchObject({ position: 0, requested: 'openai:gpt-4o', used: 'fake:default' });
});

it('uses the sub-agent default model when the step has no override', async () => {
  const seen: Array<string | undefined> = [];
  const deps = makeDeps({
    steps: [{ subAgentName: 'a', promptTemplate: '', pauseAfter: false }],
    subAgents: [{ name: 'a', model: 'gemini:gemini-1.5-pro' }],
    providers: { isAvailable: (n) => n === 'gemini:gemini-1.5-pro', defaultName: () => 'fake:default' },
    onHandle: (body) => seen.push(body.providerName),
  });
  await runSwarm(deps, { swarmId: 'sw', input: 'go' }, sse, signal);
  expect(seen).toEqual(['gemini:gemini-1.5-pro']);
});

it('passes undefined and does not warn when nothing is requested', async () => {
  const events = recordEvents(sse);
  const seen: Array<string | undefined> = [];
  const deps = makeDeps({
    steps: [{ subAgentName: 'a', promptTemplate: '', pauseAfter: false }],
    subAgents: [{ name: 'a' }],
    providers: { isAvailable: () => false, defaultName: () => 'fake:default' },
    onHandle: (body) => seen.push(body.providerName),
  });
  await runSwarm(deps, { swarmId: 'sw', input: 'go' }, sse, signal);
  expect(seen).toEqual([undefined]);
  expect(events.find((e) => e.name === 'swarm_step_warning')).toBeUndefined();
});
```

(`makeDeps`, `recordEvents`, `sse`, `signal` mirror the existing test helpers; extend `makeDeps` to accept `providers` and `onHandle`, and to make `subAgentsStore.list()` return the `subAgents` array verbatim including any `model`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project backend server/domain/swarms/swarm.orchestrator.test.ts`
Expected: FAIL (deps has no `providers`; no `swarm_step_warning`; `providerName` never passed).

- [ ] **Step 3: Widen the dispatcher + deps interfaces**

In `server/domain/swarms/swarm.orchestrator.ts`:

```ts
export interface SwarmDispatcher {
  handle(
    body: { sessionId: string; message: string; providerName?: string },
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface SwarmOrchestratorDeps {
  store: { read(id: string): Promise<SwarmRecord | null> };
  subAgentsStore: { list(): Promise<{ name: string; model?: string }[]> };
  dispatcher: SwarmDispatcher;
  createSession: () => Promise<string>;
  approvals: SwarmApprovalRegistry;
  providers: { isAvailable(name: string): boolean; defaultName(): string | null };
  approvalTimeoutMs?: number;
}
```

- [ ] **Step 4: Resolve per step + emit warning**

In `runSwarm()`, build a name→model map from the already-fetched list, then resolve per step. Replace the existing `const known = ...` block and the `dispatcher.handle` call:

```ts
const subAgents = await deps.subAgentsStore.list();
const known = new Set(subAgents.map((s) => s.name));
const modelByName = new Map(subAgents.map((s) => [s.name, s.model] as const));
const missing = swarm.steps.find((s) => !known.has(s.subAgentName));
// ...existing missing-name fail-fast unchanged...
```

Inside the per-step loop, immediately before the `dispatcher.handle` call:

```ts
const requested = step.providerName ?? modelByName.get(step.subAgentName);
let providerName = requested;
if (requested && !deps.providers.isAvailable(requested)) {
  providerName = deps.providers.defaultName() ?? undefined;
  sse.event('swarm_step_warning', { position: i, requested, used: providerName });
}

const collector = createCollectingSse(sse);
await deps.dispatcher.handle(
  { sessionId, message: `@${step.subAgentName} ${message}`, providerName },
  collector,
  signal,
);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project backend server/domain/swarms/swarm.orchestrator.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire `providers` in the composition root**

In `server/index.ts`, extend `swarmOrchestratorDeps` (the `providers` ProviderRegistry instance is already in scope):

```ts
const swarmOrchestratorDeps = {
  store: swarmStore,
  subAgentsStore,
  dispatcher,
  createSession: async () => (await historyStore.createEmpty()).id,
  approvals: swarmApprovals,
  providers: {
    isAvailable: (name: string) => providers.get(name) !== null,
    defaultName: () => providers.defaultName(),
  },
};
```

- [ ] **Step 7: Wire `providers` in the schedule runner**

In `server/domain/schedules/schedule-runner.ts`, the inline `runSwarm(...)` deps object (~line 135-141) must also pass `providers` (the runner already holds `this.deps.providers`):

```ts
await (this.deps.runSwarm ?? realRunSwarm)(
  {
    store: this.deps.swarmStore!,
    subAgentsStore: this.deps.subAgentsStore!,
    dispatcher,
    createSession,
    approvals,
    providers: {
      isAvailable: (name: string) => this.deps.providers!.get(name) !== null,
      defaultName: () => this.deps.providers!.defaultName(),
    },
  },
  { swarmId, input },
  rec.sse, ctrl.signal,
);
```

- [ ] **Step 8: Type-check the whole project**

Run: `npm run lint`
Expected: no errors (confirms both wiring sites satisfy the widened `SwarmOrchestratorDeps`).

- [ ] **Step 9: Commit**

```bash
git add server/domain/swarms/swarm.orchestrator.ts server/domain/swarms/swarm.orchestrator.test.ts server/index.ts server/domain/schedules/schedule-runner.ts
git commit -m "feat(swarms): per-step provider resolution with fallback + swarm_step_warning"
```

---

### Task 5: Frontend — swarm step provider select + run warning

**Files:**
- Modify: `src/lib/api/swarms.api.ts` (`SwarmStep` type)
- Modify: `src/components/swarms/StepsListEditor.tsx`
- Modify: `src/hooks/useSwarmRun.ts`
- Modify: `src/components/swarms/SwarmRunPanel.tsx`
- Modify: `src/i18n/en.ts` (and any other locale files present in `src/i18n/`)
- Test: `src/hooks/useSwarmRun.test.ts` (create if absent), `src/stores/swarms.store.test.ts`

**Interfaces:**
- Consumes: backend `providerName` on steps (Task 1), `swarm_step_warning` event (Task 4), `useProvidersStore().list` (`ProviderDescriptor[]` with `name: string`).
- Produces: `SwarmStepView.warning?: { requested?: string; used?: string }`.

- [ ] **Step 1: Extend the API `SwarmStep` type**

In `src/lib/api/swarms.api.ts`:

```ts
export interface SwarmStep {
  subAgentName: string;
  promptTemplate: string;
  pauseAfter: boolean;
  providerName?: string;
}
```

- [ ] **Step 2: Add the provider `<select>` to the step editor**

In `src/components/swarms/StepsListEditor.tsx`, import the providers store and render a select next to the sub-agent select. Add at the top:

```ts
import { useProvidersStore } from '@/src/stores/providers.store';
```

Inside the component:
```ts
const providers = useProvidersStore((s) => s.list);
```

In the per-step `<div>` header row, after the sub-agent `<select>`, add:
```tsx
<select
  className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-xs text-zinc-100"
  value={step.providerName ?? ''}
  onChange={(e) => update(i, { providerName: e.target.value || undefined })}
  title="Model for this step"
>
  <option value="">Inherit</option>
  {step.providerName && !providers.some((p) => p.name === step.providerName) && (
    <option value={step.providerName}>{step.providerName} (unavailable)</option>
  )}
  {providers.map((p) => (
    <option key={p.name} value={p.name}>{p.name}</option>
  ))}
</select>
```

The `value || undefined` mapping ensures the empty "Inherit" option clears the override; the conditional `<option>` preserves a persisted-but-unavailable value (cross-device).

- [ ] **Step 3: Write the failing `useSwarmRun` reducer test**

Create/extend `src/hooks/useSwarmRun.test.ts`. Test the pure `reduce` behavior by driving the hook, or export and unit-test `reduce`. Minimal approach — export `reduce` from the hook module and test it directly:

```ts
import { reduce, type SwarmRunState } from '@/src/hooks/useSwarmRun';

const base: SwarmRunState = { running: true, steps: [{ position: 0, subAgent: 'a', output: '', status: 'running' }], pending: null, status: null, error: null };

it('records a step warning', () => {
  const next = reduce(base, 'swarm_step_warning', { position: 0, requested: 'openai:gpt-4o', used: 'fake:default' });
  expect(next.steps[0].warning).toEqual({ requested: 'openai:gpt-4o', used: 'fake:default' });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run --project frontend src/hooks/useSwarmRun.test.ts`
Expected: FAIL (`reduce` not exported / no `swarm_step_warning` case / no `warning` field).

- [ ] **Step 5: Handle the warning in the hook**

In `src/hooks/useSwarmRun.ts`:

Add `warning` to the view type and `export` the `reduce` function and `SwarmRunState`:
```ts
export interface SwarmStepView {
  position: number;
  subAgent: string;
  output: string;
  status: 'running' | 'completed';
  warning?: { requested?: string; used?: string };
}
```

Change `function reduce(` to `export function reduce(` and add a case:
```ts
case 'swarm_step_warning':
  return {
    ...s,
    steps: s.steps.map((st) =>
      st.position === data.position
        ? { ...st, warning: { requested: data.requested, used: data.used } }
        : st,
    ),
  };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run --project frontend src/hooks/useSwarmRun.test.ts`
Expected: PASS.

- [ ] **Step 7: Surface the warning in the run panel**

In `src/components/swarms/SwarmRunPanel.tsx`, where each step is rendered, add (adapt to the file's existing per-step markup):

```tsx
{step.warning && (
  <div className="text-[11px] text-status-warning">
    Requested {step.warning.requested ?? '—'}, ran on {step.warning.used ?? 'default'}
  </div>
)}
```

If no `status-warning` token exists, use `text-amber-400`.

- [ ] **Step 8: Verify the swarms store still round-trips steps**

Confirm `src/stores/swarms.store.test.ts` exercises create/update with steps; if it asserts step equality, add a `providerName` to one step fixture so the optimistic update path is covered. Run:

Run: `npx vitest run --project frontend src/stores/swarms.store.test.ts src/hooks/useSwarmRun.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/api/swarms.api.ts src/components/swarms/StepsListEditor.tsx src/hooks/useSwarmRun.ts src/hooks/useSwarmRun.test.ts src/components/swarms/SwarmRunPanel.tsx src/stores/swarms.store.test.ts src/i18n/
git commit -m "feat(swarms-ui): per-step model select + run warning"
```

---

### Task 6: Frontend — sub-agent default model select

**Files:**
- Modify: `src/lib/api/subagents.api.ts` (`SubAgentCreateInput`)
- Modify: `src/types/subagent.types.ts` (`SubAgentRecord`/`SubAgentMeta`)
- Modify: `src/components/subagents/SubAgentEditModal.tsx`

**Interfaces:**
- Consumes: backend sub-agent `model` (Task 2), `useProvidersStore().list`.
- Produces: a "Default model" control persisting `model` via the existing `persist({ ... })` path.

- [ ] **Step 1: Extend the frontend types**

In `src/types/subagent.types.ts`, add `model?: string` to `SubAgentRecord` and `SubAgentMeta` (match the backend shape).

- [ ] **Step 2: Extend the API input type**

In `src/lib/api/subagents.api.ts`:
```ts
export interface SubAgentCreateInput {
  name: string;
  systemInstruction?: string;
  skills?: string[];
  tools?: Tool[];
  model?: string;
}
```
(`SubAgentUpdateInput = Partial<SubAgentCreateInput>` already inherits `model`.)

- [ ] **Step 3: Add the default-model select to the editor**

In `src/components/subagents/SubAgentEditModal.tsx`, import the providers store:
```ts
import { useProvidersStore } from '@/src/stores/providers.store';
```
Inside the component:
```ts
const providers = useProvidersStore((s) => s.list);
```
In the rendered record body (where `record` is non-null, alongside the system-instruction control), add:
```tsx
<label className="flex flex-col gap-1 text-xs text-zinc-400">
  Default model
  <select
    className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-xs text-zinc-100"
    value={record.model ?? ''}
    onChange={(e) => persist({ model: e.target.value || undefined })}
  >
    <option value="">None</option>
    {record.model && !providers.some((p) => p.name === record.model) && (
      <option value={record.model}>{record.model} (unavailable)</option>
    )}
    {providers.map((p) => (
      <option key={p.name} value={p.name}>{p.name}</option>
    ))}
  </select>
</label>
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Run the app with the fake provider and confirm the controls render and persist:
```bash
AETHER_FAKE_PROVIDER=1 npm run dev
```
Open a sub-agent editor → set a default model; open a swarm editor → set a per-step model; run the swarm and confirm a `swarm_step_warning` notice appears when a model is unavailable.

- [ ] **Step 6: Commit**

```bash
git add src/types/subagent.types.ts src/lib/api/subagents.api.ts src/components/subagents/SubAgentEditModal.tsx
git commit -m "feat(subagents-ui): default model select"
```

---

### Task 7: Full verification + docs sync

**Files:**
- Modify: `docs/swarms.md` (note per-step/sub-agent model selection + the new `swarm_step_warning` event)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: all pass.

- [ ] **Step 2: Run coverage to confirm thresholds**

Run: `npm run test:coverage`
Expected: `server/domain/**`, `src/hooks/**`, `src/stores/**` stay ≥ 80%.

- [ ] **Step 3: Update the swarm doc**

In `docs/swarms.md`, update the "modello dati" and SSE-vocabulary sections to mention `swarm_steps.provider_name`, sub-agent `model`, the resolution chain `step.providerName ?? subAgent.model ?? session ?? default`, and the `swarm_step_warning` event. Update the limits section to remove "single model per swarm".

- [ ] **Step 4: Commit**

```bash
git add docs/swarms.md
git commit -m "docs(swarms): document per-step/sub-agent model selection"
```

---

## Self-Review

**Spec coverage:**
- Hybrid binding (sub-agent default + per-step override) → Tasks 1, 2, 3, 4. ✓
- Fallback + `swarm_step_warning` on unavailable → Task 4. ✓
- Migration 016 (both nullable columns) → Task 1. ✓
- Dispatch chain extension (sub-agent model in chat too) → Task 3. ✓
- Orchestrator pre-resolution + always-available provider to dispatch → Task 4. ✓
- API/schema round-trip → Tasks 1, 2 (backend), 5, 6 (frontend). ✓
- UI: per-step select, sub-agent default select, persisted-but-unavailable preservation, run warning → Tasks 5, 6. ✓
- Schedule-runner wiring (TS compile) → Task 4 Step 7. ✓
- Testing (stores, dispatch, orchestrator, hook, store) → each task. ✓
- Out of scope items not implemented. ✓

**Type consistency:** `SwarmStep.providerName?`, `SubAgentRecord.model?`/`SubAgentMeta.model?`, `SwarmOrchestratorDeps.providers.{isAvailable,defaultName}` (`defaultName(): string | null`), `SwarmDispatcher.handle({...providerName?})`, `SwarmStepView.warning?.{requested?,used?}`, event `swarm_step_warning {position, requested, used}` — used consistently across backend, orchestrator, hook, and UI tasks.

**Placeholder scan:** All code/test/command steps contain concrete code and exact commands; test-helper reuse is named against existing files. No TBD/TODO.
