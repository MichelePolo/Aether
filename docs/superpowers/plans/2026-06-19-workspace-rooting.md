# Race-Free Per-Context Workspace Rooting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single mutable global root of the builtin filesystem/git MCP servers with a per-context, root-scoped instance pool, so UI/swarm/scheduler/CLI never race on a shared root and a swarm's tools reach the intended workspace.

**Architecture:** `McpRegistry` keeps a lazily-spawned, LRU-capped pool of filesystem/git instances keyed by normalized root (`builtin:filesystem@<root>`). Dispatch resolves one `effectiveWorkspaceId` (`body.workspaceId ?? session.workspaceId`) → `currentRoot`, used for BOTH the prompt's `-> current` marker and the tool root. The frontend-only global re-root (`activateForSession`) is removed; the builtin `fsRoot` remains the default-root config.

**Tech Stack:** Node.js, TypeScript (strict, noEmit), better-sqlite3 (append-only numbered migrations), Vitest (backend project, node env, globals on), Zustand (frontend), Express.

## Global Constraints

- Cross-platform (Windows/macOS/Linux): `node:path` joins only; root keys are case-folded on Windows so `C:\Proj` == `c:/proj`.
- Builds on Spec 1 (`cfg.libraryDir`, `BuiltinMcpStore(db, libraryDir)`); this branch (`feat/library-dir`) already contains it.
- Filesystem instance allowed dirs = `dedupe([root, libraryDir])`; git instance allowed dirs = `[root]`. Terminal builtin is NOT rooted.
- The model always sees stable tool names `Filesystem.*` / `Git.*`. Tool gating/classification is by qualified name, which stays stable — do not change it.
- Pool cap from `AETHER_BUILTIN_POOL_MAX` (default 8).
- Non-regression invariant: the root marked `-> current` in the prompt equals the allowed root of the filesystem instance used for that dispatch.
- Migrations are append-only; next number is `017`. Never edit existing migrations.
- TypeScript strict (noUnusedLocals/noUnusedParameters); `npm run lint` is the gate. Tests colocated `*.test.ts`; Vitest globals on; backend tests `--project backend`; `@/*` aliases repo root.

---

### Task 1: `normalizeRoot` helper

**Files:**
- Create: `server/lib/normalize-root.ts`
- Create: `server/lib/normalize-root.test.ts`

**Interfaces:**
- Produces: `normalizeRoot(p: string): string` — absolute, resolved, case-folded on Windows. Used as both the pool key and the allowed-dir value.

- [ ] **Step 1: Write the failing test**

Create `server/lib/normalize-root.test.ts`:

```ts
import path from 'node:path';
import { normalizeRoot } from './normalize-root';

describe('normalizeRoot', () => {
  it('returns an absolute resolved path', () => {
    expect(normalizeRoot('.')).toBe(path.resolve('.'));
  });

  it('collapses . and .. segments', () => {
    expect(normalizeRoot('/a/b/../c')).toBe(path.resolve('/a/c'));
  });

  it('is idempotent', () => {
    const once = normalizeRoot('/a/b');
    expect(normalizeRoot(once)).toBe(once);
  });

  it('case-folds only on Windows', () => {
    const upper = normalizeRoot('/A/B');
    const lower = normalizeRoot('/a/b');
    if (process.platform === 'win32') {
      expect(upper).toBe(lower);
    } else {
      expect(upper).not.toBe(lower);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/lib/normalize-root.test.ts`
Expected: FAIL — `Cannot find module './normalize-root'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/lib/normalize-root.ts`:

```ts
import path from 'node:path';

/**
 * Normalize a directory path into a stable key for the builtin-server pool and
 * a canonical allowed-dir. Resolves to an absolute path; case-folds on Windows
 * (a case-insensitive filesystem) so `C:\Proj` and `c:/proj` map to one entry.
 */
export function normalizeRoot(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/lib/normalize-root.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/normalize-root.ts server/lib/normalize-root.test.ts
git commit -m "feat(mcp): normalizeRoot helper for per-root pool keys"
```

---

### Task 2: `BuiltinMcpStore.rootedConfigs(root)`

**Files:**
- Modify: `server/domain/mcp/builtin/builtin.store.ts` (add method near `toConfigs`, ~line 129)
- Test: `server/domain/mcp/builtin/builtin.store.test.ts`

**Interfaces:**
- Consumes: `normalizeRoot` (Task 1).
- Produces: `rootedConfigs(root: string): McpServerConfig[]` — for a normalized `root`, the enabled filesystem and/or git configs with ids `builtin:filesystem@<root>` and `builtin:git@<root>`, stable names `Filesystem`/`Git`, filesystem `args = [entry, ...dedupe([root, libraryDir])]`, git `args = [...gitArgs, root]`. Terminal is excluded (not rooted).

- [ ] **Step 1: Write the failing test**

Add to `server/domain/mcp/builtin/builtin.store.test.ts` (follow the existing setup for enabling a transport / seeding `builtin_mcp_state` rows in that file):

```ts
it('rootedConfigs builds per-root filesystem + git configs with stable names', () => {
  // enable filesystem + git in the test DB (match this file's existing helper)
  const store = new BuiltinMcpStore(db, '/lib');
  store.setEnabled('filesystem', true);
  store.setEnabled('git', true);

  const cfgs = store.rootedConfigs('/work');
  const fs = cfgs.find((c) => c.name === 'Filesystem')!;
  const git = cfgs.find((c) => c.name === 'Git')!;

  expect(fs.id).toBe('builtin:filesystem@/work');
  expect(fs.args).toContain('/work');
  expect(fs.args).toContain('/lib');           // libraryDir always-allowed
  expect(git.id).toBe('builtin:git@/work');
  expect(git.args).toContain('/work');
  expect(git.args).not.toContain('/lib');      // git is not given libraryDir
  // terminal is never rooted
  expect(cfgs.find((c) => c.name === 'Terminal')).toBeUndefined();
});

it('rootedConfigs omits disabled transports', () => {
  const store = new BuiltinMcpStore(db, '/lib');
  store.setEnabled('filesystem', false);
  store.setEnabled('git', false);
  expect(store.rootedConfigs('/work')).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/mcp/builtin/builtin.store.test.ts`
Expected: FAIL — `rootedConfigs is not a function`.

- [ ] **Step 3: Implement `rootedConfigs`**

In `server/domain/mcp/builtin/builtin.store.ts`, add after `toConfigs` (after line ~129, inside the class):

```ts
  /**
   * Per-root configs for the rooted builtin transports (filesystem, git). Each
   * gets an id suffixed with the root so the registry can pool one instance per
   * root. Filesystem always-allows the libraryDir alongside the root; git does
   * not. Terminal is excluded — it is never workspace-rooted.
   */
  rootedConfigs(root: string): McpServerConfig[] {
    const rows = this.read().filter((r) => r.enabled);
    const out: McpServerConfig[] = [];
    for (const r of rows) {
      if (r.transport === 'filesystem') {
        const allowed = this.libraryDir && this.libraryDir !== root
          ? [root, this.libraryDir]
          : [root];
        out.push({
          id: `builtin:filesystem@${root}`,
          name: 'Filesystem',
          transport: 'stdio',
          command: process.execPath,
          args: [resolveFilesystemServerEntry(), ...allowed],
          env: {},
          status: 'offline',
        } as McpServerConfig);
      } else if (r.transport === 'git') {
        out.push({
          id: `builtin:git@${root}`,
          name: 'Git',
          transport: 'stdio',
          command: process.execPath,
          args: [...resolveAetherGitArgs(), root],
          env: {},
          status: 'offline',
        } as McpServerConfig);
      }
    }
    return out;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/domain/mcp/builtin/builtin.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/builtin/builtin.store.ts server/domain/mcp/builtin/builtin.store.test.ts
git commit -m "feat(mcp): BuiltinMcpStore.rootedConfigs for per-root builtin instances"
```

---

### Task 3: Registry pool — `ensureRootedBuiltins` + LRU eviction

**Files:**
- Modify: `server/domain/mcp/registry.ts`
- Test: `server/domain/mcp/registry.test.ts`

**Interfaces:**
- Consumes: `BuiltinMcpStore.rootedConfigs(root)` (Task 2), `normalizeRoot` (Task 1), the existing private `connectFromConfig(cfg)` and `disconnect(id)`.
- Produces: `ensureRootedBuiltins(root: string): Promise<void>` — spawn (if absent) the rooted filesystem/git instances for the **already-normalized** `root`, mark it most-recently-used, and close the least-recently-used root set when the distinct-root count exceeds `AETHER_BUILTIN_POOL_MAX` (default 8). Idempotent for a live root.

- [ ] **Step 1: Write the failing test**

In `server/domain/mcp/registry.test.ts` (follow the file's existing construction of `McpRegistry` + a `BuiltinMcpStore` test double; if the existing tests stub builtin spawning, reuse that seam), add:

```ts
it('ensureRootedBuiltins pools one instance set per distinct root', async () => {
  // Arrange a registry whose builtinStore.rootedConfigs returns mock-transport
  // configs (transport: 'mock') so no real process spawns. See note below.
  await reg.ensureRootedBuiltins('/work-a');
  await reg.ensureRootedBuiltins('/work-a'); // idempotent
  await reg.ensureRootedBuiltins('/work-b');

  expect(reg.stateOf('builtin:filesystem@/work-a').state).toBe('online');
  expect(reg.stateOf('builtin:filesystem@/work-b').state).toBe('online');
});

it('evicts the least-recently-used root set when over the cap', async () => {
  // cap forced to 2 for the test via AETHER_BUILTIN_POOL_MAX or a constructor seam
  await reg.ensureRootedBuiltins('/r1');
  await reg.ensureRootedBuiltins('/r2');
  await reg.ensureRootedBuiltins('/r1'); // touch r1 -> r2 is now LRU
  await reg.ensureRootedBuiltins('/r3'); // over cap -> evict r2

  expect(reg.stateOf('builtin:filesystem@/r2').state).toBe('offline');
  expect(reg.stateOf('builtin:filesystem@/r1').state).toBe('online');
  expect(reg.stateOf('builtin:filesystem@/r3').state).toBe('online');
});
```

Note for the implementer: the existing `registry.test.ts` already constructs a registry with a builtin store and a connection seam. Use the `mock` transport path (`MockMcpConnection`, already supported in `makeConnection`) so `ensureRootedBuiltins` does not spawn real `server-filesystem` processes. If `rootedConfigs` cannot yield mock configs, add a minimal test seam: have `ensureRootedBuiltins` consume `this.builtinStore.rootedConfigs(root)` and construct the test's `BuiltinMcpStore` subclass/override that returns `transport: 'mock'` configs with the same ids. Read the existing tests first and match their established pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/mcp/registry.test.ts`
Expected: FAIL — `ensureRootedBuiltins is not a function`.

- [ ] **Step 3: Implement the pool**

In `server/domain/mcp/registry.ts`, add a cap constant near the top:

```ts
const BUILTIN_POOL_MAX = (() => {
  const n = parseInt(process.env.AETHER_BUILTIN_POOL_MAX ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 8;
})();
```

Add an LRU field to the class (next to `private live = ...`):

```ts
  /** Normalized roots with live builtin instances, most-recently-used last. */
  private rootedLru: string[] = [];
```

Add the method (place near `startBuiltin`):

```ts
  /**
   * Ensure the rooted filesystem/git builtin instances for `root` are live.
   * `root` must already be normalized (see normalizeRoot). Touches LRU and
   * closes the least-recently-used root's instances when over the pool cap.
   */
  async ensureRootedBuiltins(root: string): Promise<void> {
    if (!this.builtinStore) return;
    for (const cfg of this.builtinStore.rootedConfigs(root)) {
      if (!this.live.has(cfg.id)) {
        await this.connectFromConfig(cfg).catch(() => {
          /* a failed root instance surfaces as an offline tool, not a crash */
        });
      }
    }
    this.rootedLru = this.rootedLru.filter((r) => r !== root);
    this.rootedLru.push(root);
    while (this.rootedLru.length > BUILTIN_POOL_MAX) {
      const evict = this.rootedLru.shift()!;
      await this.disconnect(`builtin:filesystem@${evict}`);
      await this.disconnect(`builtin:git@${evict}`);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/domain/mcp/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/registry.ts server/domain/mcp/registry.test.ts
git commit -m "feat(mcp): lazy LRU-capped pool of per-root builtin instances"
```

---

### Task 4: Registry — root-aware `listLiveTools` and `callTool`

**Files:**
- Modify: `server/domain/mcp/registry.ts:128-174`
- Test: `server/domain/mcp/registry.test.ts`

**Interfaces:**
- Consumes: the pool from Task 3.
- Produces: `listLiveTools(root?: string): LiveTool[]` — non-rooted servers + only the `root`'s rooted builtins (stable `Filesystem.*`/`Git.*` names). `callTool(qualifiedName, args, opts?: { root?: string } & CallToolOpts)` — routes `Filesystem.*`/`Git.*` to `builtin:<transport>@<root>`; others unchanged. `getAvailableTools(root?)` forwards to `listLiveTools(root)`.

- [ ] **Step 1: Write the failing test**

Add to `server/domain/mcp/registry.test.ts`:

```ts
it('listLiveTools(root) returns only that root\'s builtin instance', async () => {
  await reg.ensureRootedBuiltins('/work-a');
  await reg.ensureRootedBuiltins('/work-b');
  const toolsA = reg.listLiveTools('/work-a');
  // Filesystem tools appear once (stable name), from the /work-a instance only
  const fsTools = toolsA.filter((t) => t.serverName === 'Filesystem');
  expect(fsTools.length).toBeGreaterThan(0);
  expect(fsTools.every((t) => t.serverId === 'builtin:filesystem@/work-a')).toBe(true);
});

it('callTool routes Filesystem.* to the root-scoped instance', async () => {
  await reg.ensureRootedBuiltins('/work-a');
  const res = await reg.callTool('Filesystem.list_directory', { path: '/work-a' }, { root: '/work-a' });
  expect(res.ok).toBe(true); // mock connection returns ok
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/mcp/registry.test.ts`
Expected: FAIL — `listLiveTools` ignores `root` / `callTool` lacks `root` routing.

- [ ] **Step 3: Make `listLiveTools` and `callTool` root-aware**

In `server/domain/mcp/registry.ts`, replace `listLiveTools()` (lines 128-144) with:

```ts
  listLiveTools(root?: string): LiveTool[] {
    const out: LiveTool[] = [];
    const fsId = root ? `builtin:filesystem@${root}` : null;
    const gitId = root ? `builtin:git@${root}` : null;
    for (const entry of this.live.values()) {
      const id = entry.serverId;
      const isRooted = id.startsWith('builtin:filesystem@') || id.startsWith('builtin:git@');
      // Skip rooted instances that belong to a different root.
      if (isRooted && id !== fsId && id !== gitId) continue;
      for (const tool of entry.tools) {
        const policy = this.resolvePolicy(entry, tool.name);
        out.push({
          qualifiedName: `${entry.serverName}.${tool.name}`,
          serverId: entry.serverId,
          serverName: entry.serverName,
          tool,
          autoApprove: policy.autoApprove === true,
          ...(policy.category ? { category: policy.category } : {}),
        });
      }
    }
    return out;
  }
```

Update `getAvailableTools` (line 158) to forward the root:

```ts
  getAvailableTools(root?: string): LiveTool[] {
    return this.listLiveTools(root);
  }
```

Replace `callTool` (lines 162-174) so a `root` opt routes builtins to the right instance:

```ts
  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>,
    opts?: { root?: string } & CallToolOpts,
  ): Promise<McpToolResult> {
    const sep = qualifiedName.indexOf('.');
    if (sep < 0) return { ok: false, error: `Invalid qualified name '${qualifiedName}'` };
    const serverName = qualifiedName.slice(0, sep);
    const toolName = qualifiedName.slice(sep + 1);
    let entry: LiveEntry | undefined;
    if (opts?.root && (serverName === 'Filesystem' || serverName === 'Git')) {
      const id = serverName === 'Filesystem'
        ? `builtin:filesystem@${opts.root}`
        : `builtin:git@${opts.root}`;
      entry = this.live.get(id);
    } else {
      entry = [...this.live.values()].find((e) => e.serverName === serverName);
    }
    if (!entry) return { ok: false, error: `Server '${serverName}' is offline` };
    return entry.connection.callTool(toolName, args, opts);
  }
```

(Confirm `CallToolOpts` is already imported at the top of the file — it is, via `connection.types`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/domain/mcp/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the broader MCP suite for regressions**

Run: `npx vitest run --project backend server/domain/mcp/`
Expected: PASS (existing tests that call `listLiveTools()` / `callTool(name, args)` without a root still work — the params are optional).

- [ ] **Step 6: Commit**

```bash
git add server/domain/mcp/registry.ts server/domain/mcp/registry.test.ts
git commit -m "feat(mcp): root-aware listLiveTools and callTool routing"
```

---

### Task 5: Dispatch threading + non-regression invariant

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts` (handle ~499-509, resume ~710-719, executeToolCall ~173, the body type)
- Test: `server/domain/dispatch/dispatch.service.test.ts`

**Interfaces:**
- Consumes: `ensureRootedBuiltins`, `listLiveTools(root)`, `callTool(…,{root})` (Tasks 3-4), `normalizeRoot` (Task 1), existing `projectRootFor`.
- Produces: dispatch resolves `currentRoot` once and threads it through tools + prompt. Body accepts optional `workspaceId`.

- [ ] **Step 1: Write the failing test**

In `server/domain/dispatch/dispatch.service.test.ts`, add a test asserting the invariant (follow the file's existing harness — FakeProvider, makeTestDb, a registry double that records the `root` it was asked for):

```ts
it('roots tools at the same workspace the prompt marks current (body override)', async () => {
  // A session in workspace W1; the dispatch body overrides to W2.
  // Assert: ensureRootedBuiltins / listLiveTools were called with W2's root,
  // and the assembled_prompt "-> current" line names W2's root.
  // (Build with the same makeTestDb + workspace-row insert pattern used by the
  //  existing "injects ETERE.md from the session workspace root" test.)
});
```

Implement the assertion against a registry spy capturing the `root` argument and the captured `assembled_prompt` reasoning step text (the existing tests already capture `assembled_prompt`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/dispatch/dispatch.service.test.ts -t "roots tools at the same workspace"`
Expected: FAIL — dispatch ignores `body.workspaceId` and uses an unrooted tool list.

- [ ] **Step 3: Thread the effective root through dispatch**

In `server/domain/dispatch/dispatch.service.ts`:

(a) Import `normalizeRoot` at the top:

```ts
import { normalizeRoot } from '@/server/lib/normalize-root';
```

(b) Allow `workspaceId` in the request body type (find the `handle(body: …)` parameter type and add `workspaceId?: string`).

(c) In `handle()`, before building tools (near line 499), compute the effective root once:

```ts
    const effectiveWorkspaceId = body.workspaceId ?? sessionRecord?.workspaceId;
    const currentRoot = normalizeRoot(
      this.deps.projectRootFor?.(effectiveWorkspaceId) ?? process.cwd(),
    );
    await this.deps.mcpRegistry?.ensureRootedBuiltins(currentRoot);
    const liveTools = this.deps.mcpRegistry?.listLiveTools(currentRoot) ?? [];
```

(replace the existing `const liveTools = this.deps.mcpRegistry?.listLiveTools() ?? [];` at line 499.)

(d) Change `resolveRuntimeContext(sessionRecord?.workspaceId, providerName)` (line 509) to:

```ts
    const runtime = this.resolveRuntimeContext(effectiveWorkspaceId, providerName);
```

(e) Store `currentRoot` so tool execution can pass it. Thread it into `executeToolCall` and at the `callTool` site (line ~173) pass `{ root: currentRoot, ... }`. The simplest seam: pass `currentRoot` as a parameter through the dispatch loop to `executeToolCall`, then:

```ts
      const result = await this.deps.mcpRegistry!.callTool(
        pendingCall.qualifiedName,
        pendingCall.args as Record<string, unknown>,
        { root: currentRoot, /* keep existing opts (callId, signal, onProgress) */ },
      );
```

(f) Apply the same `effectiveWorkspaceId`/`currentRoot` resolution in `resume()` (lines ~710-719): use `effectiveWorkspaceId = sessionRecord.workspaceId` (resume has no new body workspaceId — keep session's), `ensureRootedBuiltins`, `listLiveTools(currentRoot)`, `resolveRuntimeContext(effectiveWorkspaceId, …)`, and `callTool({ root: currentRoot })`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project backend server/domain/dispatch/dispatch.service.test.ts`
Expected: PASS (new invariant test + existing dispatch tests).

- [ ] **Step 5: Type-check + commit**

```bash
npm run lint
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "feat(dispatch): resolve effective workspace root once for tools + prompt"
```

---

### Task 6: Swarm per-step / per-swarm workspace

**Files:**
- Create: `server/db/migrations/017_swarm_workspace.sql`
- Modify: `server/domain/swarms/swarm.schema.ts`, `server/domain/swarms/swarm.store.ts`, `server/domain/swarms/swarm.types.ts`, `server/domain/swarms/swarm.orchestrator.ts`
- Test: `server/domain/swarms/swarm.store.test.ts`, `server/domain/swarms/swarm.orchestrator.test.ts`

**Interfaces:**
- Consumes: dispatch body `workspaceId` (Task 5).
- Produces: `SwarmStep.workspaceId?: string`, `SwarmRecord.workspaceId?: string`; orchestrator passes `effective = step.workspaceId ?? swarm.workspaceId` via `dispatcher.handle({ …, workspaceId })`.

- [ ] **Step 1: Write the migration**

Create `server/db/migrations/017_swarm_workspace.sql`:

```sql
-- Per-swarm default workspace + per-step override, so a swarm's builtin tools
-- root at the intended workspace (NULL = no rooting, prior behavior).
ALTER TABLE swarms ADD COLUMN workspace_id TEXT;
ALTER TABLE swarm_steps ADD COLUMN workspace_id TEXT;
```

- [ ] **Step 2: Write the failing store test**

In `server/domain/swarms/swarm.store.test.ts`, add a test that creates a swarm with a top-level `workspaceId` and a step with its own `workspaceId`, reads it back, and asserts both survive a round-trip (follow the file's existing create/read pattern):

```ts
it('persists swarm-level and per-step workspaceId', async () => {
  const meta = await store.create({
    name: 'ws',
    workspaceId: 'w-default',
    steps: [
      { subAgentName: 'a', promptTemplate: '', pauseAfter: false, workspaceId: 'w-step' },
      { subAgentName: 'b', promptTemplate: '', pauseAfter: false },
    ],
  });
  const rec = await store.read(meta.id);
  expect(rec!.workspaceId).toBe('w-default');
  expect(rec!.steps[0].workspaceId).toBe('w-step');
  expect(rec!.steps[1].workspaceId).toBeUndefined();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run --project backend server/domain/swarms/swarm.store.test.ts`
Expected: FAIL — column/field not handled.

- [ ] **Step 4: Add `workspaceId` to schema, types, store**

In `server/domain/swarms/swarm.schema.ts`, add to `SwarmStepSchema`:

```ts
  workspaceId: z.string().min(1).max(120).optional(),
```

and to `SwarmCreateInputSchema` (alongside `name`/`steps`):

```ts
  workspaceId: z.string().min(1).max(120).optional(),
```

In `server/domain/swarms/swarm.types.ts`, add `workspaceId?: string` to the step and swarm record types (match the existing type names in that file).

In `server/domain/swarms/swarm.store.ts`:
- Extend `StepRow` (line 12) with `workspace_id: string | null`.
- In the steps `SELECT` (line 40) add `workspace_id`; map `...(s.workspace_id ? { workspaceId: s.workspace_id } : {})`.
- In the swarm `SELECT`/read, select `workspace_id` and map it onto the record.
- In the swarm `INSERT` (line 57) include `workspace_id`; in the step `INSERT` (line 97) include `workspace_id`, binding `step.workspaceId ?? null`.

- [ ] **Step 5: Run the store test to verify it passes**

Run: `npx vitest run --project backend server/domain/swarms/swarm.store.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing orchestrator test**

In `server/domain/swarms/swarm.orchestrator.test.ts`, add a test that runs a 2-step swarm (swarm default `w-default`, step 0 override `w-step`) and asserts the dispatcher received `workspaceId: 'w-step'` for step 0 and `'w-default'` for step 1 (the file already uses a `dispatcher` double — assert on its recorded call bodies):

```ts
it('passes effective workspaceId (step override else swarm default) to dispatch', async () => {
  // swarm: workspaceId 'w-default', steps [{ ..., workspaceId: 'w-step' }, { ... }]
  // run, then assert dispatcher.handle was called with workspaceId 'w-step' then 'w-default'
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run --project backend server/domain/swarms/swarm.orchestrator.test.ts -t "effective workspaceId"`
Expected: FAIL — orchestrator does not pass `workspaceId`.

- [ ] **Step 8: Pass the effective workspace through the orchestrator**

In `server/domain/swarms/swarm.orchestrator.ts`:
- Extend the `SwarmDispatcher.handle` body type (line 8) to include `workspaceId?: string`.
- In the loop (near line 87), compute and pass it:

```ts
    const stepWorkspaceId = step.workspaceId ?? swarm.workspaceId;
    await deps.dispatcher.handle(
      { sessionId, message: `@${step.subAgentName} ${message}`, providerName, workspaceId: stepWorkspaceId },
      collector,
      signal,
    );
```

- [ ] **Step 9: Run the swarm suite to verify it passes**

Run: `npx vitest run --project backend server/domain/swarms/`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add server/db/migrations/017_swarm_workspace.sql server/domain/swarms/
git commit -m "feat(swarms): per-step / per-swarm workspace selection"
```

---

### Task 7: Remove the global re-root; keep `fsRoot` as default

**Files:**
- Modify: `server/routes/workspaces.routes.ts:73-101` (remove the `activate-for-session` re-root side-effect)
- Modify: `src/stores/sessions.store.ts:174,224` (remove the `activateForSession` calls)
- Modify: `src/lib/api/workspaces.api.ts` (remove `activateForSession` client if now unused)
- Modify: `server/routes/builtin-mcp.routes.ts` (on `setFsRoot`, invalidate cached default-root instances instead of reconnecting a global)
- Test: `server/routes/workspaces.routes.test.ts` (or the colocated route test), `src/stores/sessions.store.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no global re-root remains; `setFsRoot` invalidates default-root cache.

- [ ] **Step 1: Write/adjust the failing test**

In the workspaces route test, replace any test asserting `activate-for-session` mutates builtin `fsRoot` / calls `reconnectBuiltin` with a test asserting the route no longer does so (or that the route is gone — a request to it 404s). In `src/stores/sessions.store.test.ts`, remove/adjust expectations that `activateForSession` is called on session switch.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run server/routes/workspaces.routes.test.ts src/stores/sessions.store.test.ts`
Expected: FAIL against the new expectations.

- [ ] **Step 3: Remove the re-root**

In `server/routes/workspaces.routes.ts`, delete the `/activate-for-session` handler (lines 73-101) and the `ActivateBody` schema (line 20). In `src/stores/sessions.store.ts`, delete the two `workspacesApi.activateForSession(...)` calls (lines 174, 224). In `src/lib/api/workspaces.api.ts`, delete the `activateForSession` method. Run `npm run lint` to surface any now-unused imports and remove them.

- [ ] **Step 4: Invalidate the default-root cache on `setFsRoot`**

In `server/routes/builtin-mcp.routes.ts`, where `setFsRoot` is handled (around line 42), replace the `mcpRegistry.reconnectBuiltin(...)` call for filesystem/git with closing any cached default-root instances so the next dispatch rebuilds with the new default. Add a registry method `invalidateDefaultRoots(): Promise<void>` that disconnects `builtin:filesystem@<normalizeRoot(cwd)>` and any instance whose root is not a registered workspace — or, simplest and sufficient: disconnect ALL rooted builtins so they re-spawn lazily with the new config:

```ts
  /** Drop all rooted builtin instances so the next dispatch re-spawns them with
   *  current config (used when the default fsRoot changes). */
  async invalidateRootedBuiltins(): Promise<void> {
    const roots = [...this.rootedLru];
    this.rootedLru = [];
    for (const r of roots) {
      await this.disconnect(`builtin:filesystem@${r}`);
      await this.disconnect(`builtin:git@${r}`);
    }
  }
```

Call `await deps.mcpRegistry.invalidateRootedBuiltins()` in the `setFsRoot` route after persisting. Keep `reconnectBuiltin` for the terminal transport only.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run server/routes/ src/stores/sessions.store.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check + commit**

```bash
npm run lint
git add server/routes/workspaces.routes.ts src/stores/sessions.store.ts src/lib/api/workspaces.api.ts server/routes/builtin-mcp.routes.ts server/domain/mcp/registry.ts server/routes/workspaces.routes.test.ts src/stores/sessions.store.test.ts
git commit -m "refactor(mcp): remove global re-root; fsRoot is the default, cache-invalidated"
```

---

### Task 8: Git gate preview uses the dispatch's effective root

**Files:**
- Modify: `server/domain/mcp/breakpoints/preview.service.ts:14,68,103`
- Modify: the wiring that constructs the preview service (so it can receive a per-call root)
- Test: `server/domain/mcp/breakpoints/preview.service.test.ts`

**Interfaces:**
- Consumes: the `currentRoot` resolved in dispatch (Task 5).
- Produces: the git commit-list preview resolves its repo from the dispatch's effective root, not the global `gitRoot()`.

- [ ] **Step 1: Inspect the preview call path**

Read `server/domain/mcp/breakpoints/preview.service.ts` and `breakpoints.service.ts` to see how `gitRoot()` is used (lines 68, 103) and how the preview is invoked from dispatch's gate flow. Determine whether the effective root can be passed in at preview time (preferred) or whether the injected `gitRoot` resolver should be replaced by a per-dispatch value.

- [ ] **Step 2: Write the failing test**

In `server/domain/mcp/breakpoints/preview.service.test.ts`, add a test that the git preview uses a supplied root rather than the injected default `gitRoot()` — e.g. construct the preview with `gitRoot: () => '/default'`, invoke the git preview with an explicit root `/work`, and assert the git command ran against `/work`.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run --project backend server/domain/mcp/breakpoints/preview.service.test.ts`
Expected: FAIL — preview still uses `gitRoot()`.

- [ ] **Step 4: Thread the effective root into the preview**

Make the git preview accept an optional explicit root (default to `gitRoot()` when absent, preserving today's behavior for callers that don't supply one), and have the dispatch gate flow pass `currentRoot`. Keep the change minimal: an optional parameter on the preview method, defaulting to the injected resolver.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project backend server/domain/mcp/breakpoints/`
Expected: PASS.

- [ ] **Step 6: Full suite + commit**

```bash
npm run lint
npx vitest run --project backend
git add server/domain/mcp/breakpoints/ server/domain/dispatch/dispatch.service.ts
git commit -m "fix(breakpoints): git gate preview uses the dispatch's effective root"
```

---

## Self-Review

**Spec coverage:**
- Root-scoped pool + keying + normalization → Tasks 1, 2, 3 ✓
- `listLiveTools(root)` / `callTool(…,{root})` / stable names → Task 4 ✓
- Dispatch threading + body workspaceId + invariant → Task 5 ✓
- Swarm default + per-step + migration + validation → Task 6 (validation: schema enforces non-empty; registered-workspace check is enforced at the route via the existing workspace store — see note) ✓
- Remove global re-root, keep fsRoot default, cache-invalidate → Task 7 ✓
- Git gate preview effective root; UI git panel unaffected (no change needed) → Task 8 ✓
- Error handling (failed root instance → offline tool, not crash) → Task 3 Step 3 (`.catch`) ✓
- No-race test → covered by Task 3 (distinct roots = distinct instances) + Task 4 (root-scoped routing); add an explicit two-root concurrency assertion in Task 4 if not already implied.

**Registered-workspace validation note:** Task 6 Step 4 enforces shape (non-empty string). The spec also wants a non-empty `workspaceId` to reference a *registered* workspace. Enforce this in the swarm create/update route (`server/routes/swarms.routes.ts`) by checking each `workspaceId` against `workspacesStore` and returning `ValidationError` on unknown — fold this into Task 6 Step 8 (add the route-level check + a route test), since the route already has access to the store via deps. If the route lacks the workspace store, thread it through `createSwarmRoutes` deps.

**Placeholder scan:** Task 5 and Task 8 test bodies are described rather than fully written because they must match each file's existing bespoke harness (FakeProvider/makeTestDb capture seams, the preview gate wiring). The implementer reads those files first; the assertions to make are stated exactly. All production-code steps contain complete code.

**Type consistency:** `normalizeRoot(p): string`, `rootedConfigs(root): McpServerConfig[]`, `ensureRootedBuiltins(root): Promise<void>`, `listLiveTools(root?)`, `callTool(name, args, { root })`, `invalidateRootedBuiltins()`, `SwarmStep.workspaceId?`, `SwarmRecord.workspaceId?` — consistent across tasks.
