# Race-free per-context workspace rooting for builtin tools — Design

**Date:** 2026-06-19
**Status:** approved (design), pending implementation plan

## Goal

Make Aether's builtin filesystem/git tools rooted **per execution context**
instead of via a single mutable global root, so that UI sessions, swarms, the
scheduler, and the CLI can all run without racing each other on a shared root —
and so a swarm's tools reach the workspace the user intends.

This is **Spec 2 of 2**. It builds on Spec 1 (the data-agnostic `libraryDir`,
branch `feat/library-dir`) and depends on `cfg.libraryDir`.

### The bug this fixes

The builtin filesystem MCP server is a single long-lived process with **one
global allowed directory** (`fsRoot ?? cwd`). That root is mutated + the server
restarted by a frontend-only side-effect (`POST /api/workspaces/activate-for-session`,
`workspaces.routes.ts`). Server-side entry points (swarms via `runSwarm`, the
scheduler, the CLI) never call it, so their tools are rooted at the wrong place
→ "access denied / no grants" when an agent lists a workspace path. Even from
the UI, the swarm session has no `workspaceId`, so the agent isn't told the
correct root and passes a path the filesystem server rejects.

Because the root is a shared mutable global, two concurrent contexts on
different workspaces (e.g. a scheduled swarm + interactive chat) also stomp on
each other. The fix removes the shared mutable state entirely.

## Non-goals

- File-based agents (still SQLite-backed; out of scope, as in Spec 1).
- A CLI `aether swarm run` subcommand (separate small feature; the dispatch
  `workspaceId` channel this spec adds is what it would later use).
- Changing the terminal builtin (`aether-shell`), which is not workspace-rooted.

## Architecture (Approach A: per-context instance pool)

### Root-scoped builtin instances

The `McpRegistry` stops keeping one global `builtin:filesystem` / `builtin:git`
instance and instead keeps a **pool of root-scoped instances**, keyed
`builtin:filesystem@<rootNorm>` and `builtin:git@<rootNorm>`. Each instance is
launched once with its own allowed dirs and is **never mutated**.

- filesystem `@R` allowed dirs = `dedupe([R, libraryDir])` (the Spec 1 stopgap,
  now injected per instance rather than on a global singleton).
- git `@R` allowed dirs = `[R]`.

The model always sees one stable tool set (`Filesystem.*` / `Git.*`); only
**which instance** the registry queries/routes to changes, per the dispatch's
root. Prompts, policies, and the model's experience are unchanged.

### Root resolution (per dispatch)

`effectiveWorkspaceId = body.workspaceId ?? session.workspaceId`, then
`currentRoot = normalizeRoot(projectRootFor(effectiveWorkspaceId) ?? process.cwd())`.
`projectRootFor` (`index.ts:209`) is the single workspaceId→rootPath mapping
(workspace root → builtin `fsRoot` default → `null`), reused unchanged; the
dispatch applies the final `?? process.cwd()` so an unrooted context matches
today's `toConfigs` default (`fsRoot ?? defaultCwd`).

### Path normalization (Windows)

`normalizeRoot(p)` = `path.resolve(p)` + separator normalization + case-fold on
Windows, so `C:\Proj` and `c:/proj` map to one pool key and one allowed-dir.
This is where cross-platform root mismatches historically hide.

### Pool lifecycle

Instances are created lazily on first use for a root (respecting the transport's
`enabled` flag), and the pool keeps at most `N` roots (LRU; default 8,
configurable via `AETHER_BUILTIN_POOL_MAX`). On overflow the least-recently-used
root's instance **set** (filesystem + git together) is closed. The default-root
instance is an ordinary LRU entry. The terminal builtin stays global (not
rooted); filesystem/git are no longer pre-started globally at boot.

## Components

### A. `McpRegistry` API (root-aware)

- `ensureRootedBuiltins(root: string): Promise<void>` — lazily spawn filesystem
  (`[root, libraryDir]`) and git (`[root]`) instances for `root` if absent;
  update LRU; evict the LRU set on overflow. Configs come from a new
  `BuiltinMcpStore.rootedConfigs(root, libraryDir)` that reuses `toConfigs`
  logic with an explicit root, carrying the same `toolPolicies` so gate/auto
  parity holds across roots.
- `listLiveTools(root?: string): LiveTool[]` — non-rooted servers (external MCP,
  terminal) as today, plus **only** the filesystem/git instance for `root`,
  qualified with the stable `Filesystem.*` / `Git.*` names. `root` undefined →
  default root.
- `callTool(qualifiedName, args, opts: { root?: string, ... })` — route
  `Filesystem.*` / `Git.*` to `builtin:filesystem@<root>` / `builtin:git@<root>`;
  everything else uses the existing global lookup.
- `list()` (UI server list, excludes builtins) is unchanged.

### B. Dispatch threading (`dispatch.service.ts`)

- Add optional `workspaceId` to the dispatch request body.
- Compute `effectiveWorkspaceId` and `currentRoot` once at the top of `handle()`
  and `resume()`.
- `resolveRuntimeContext(effectiveWorkspaceId, …)` (changed from
  `session.workspaceId`) — feeds the `# availableWorkspaces` `-> current` marker.
- `await mcpRegistry.ensureRootedBuiltins(currentRoot)`, then
  `listLiveTools(currentRoot)` for tool declarations and
  `callTool(…, { root: currentRoot })` for execution.

**Non-regression invariant (enforced by test):** the root marked `-> current`
in the prompt equals the allowed root of the filesystem instance used for that
dispatch. Both derive from the same `currentRoot` via the same
`projectRootFor(effectiveWorkspaceId)`, so they cannot diverge. This is strictly
better than today, where the prompt's current (from `session.workspaceId`) and
the tool root (from the global re-root) can already drift — that drift is the
bug. The `# availableWorkspaces` list itself (all registered roots via
`listWorkspaceRoots()`) is independent of the effective workspace and unchanged.

### C. Swarm config + orchestrator

- `SwarmStepSchema` gains `workspaceId: z.string().optional()` (per-step
  override); `SwarmCreateInputSchema` gains a top-level `workspaceId`
  (swarm default).
- Save-time validation: a non-empty `workspaceId` must reference a **registered**
  workspace, else reject.
- Migration: append-only `NNN_swarm_workspace.sql` adds `workspace_id` to the
  swarm and step tables; existing rows get `NULL` (no forced rooting → unchanged
  behavior).
- `runSwarm`: per step `effective = step.workspaceId ?? swarm.workspaceId`,
  passed via `dispatcher.handle({ …, workspaceId: effective })`. The
  `SwarmDispatcher.handle` body gains `workspaceId?`.

Body-override (rather than mutating `session.workspaceId` between steps) keeps
the swarm session's record stable and avoids shared mutable state; it is the
same channel a future `aether run --workspace` / `aether swarm run` would use.

### D. Remove the global re-root; keep `fsRoot` as the default

- Remove `activateForSession`'s side-effect (the `setFsRoot` + `reconnectBuiltin`
  loop that mutates global state — the race) and the now-pointless frontend
  calls (`sessions.store.ts:174,224`) and the route.
- Keep `setFsRoot` (builtin `fsRoot`, `BuiltinMcpToggles`) as the **default-root**
  control for contexts with no workspace. When it changes, invalidate (close)
  the cached default-root instances so the next dispatch rebuilds with the new
  default — cache invalidation, not shared mutation.
- `reconnectBuiltin` stays for the terminal builtin.

**Git gate preview:** `preview.service.ts` resolves the git root via the global
`gitRoot()` (`index.ts:90` = builtin git `fsRoot`). Once the per-session re-root
is removed, that global is only the default, so a gated git tool call from a
workspace-rooted context could preview the wrong repo's commits. Make the git
gate preview use the dispatch's **effective root** (the same `currentRoot`), so
preview, prompt, and the actual git op all agree.

**Not affected — the UI git panel.** It resolves its root from an explicit
`workspaceId` (`GitService.resolveCwd` → `workspacesStore.get(id).rootPath`,
`git.service.ts:15-18`); switching workspace in the UI just re-queries
`/api/git/*?workspaceId=…`. It never depended on the global re-root, so removing
`activateForSession` does not regress it.

## Error handling

- A rooted-instance spawn failure (e.g. a non-existent root) degrades that
  tool's call with a clear error, without crashing the dispatch (as today for an
  offline server).
- A `body`/step `workspaceId` that does not resolve to a root falls back to the
  default with a warning; it does not block the run.

## Testing

- **No-race (central):** two concurrent dispatches on different roots use
  different instances with no cross-talk; two on the same root share an instance
  without interference. This is the direct proof of the goal.
- **Prompt↔tool invariant:** the `-> current` root equals the filesystem
  instance's allowed root for the dispatch.
- **Windows normalization:** `C:\Proj` and `c:/proj` produce one instance.
- **LRU:** over the cap, the least-recently-used set is closed; same root reuses.
- **Swarm per-step:** step override → correct root; absent → swarm default; both
  absent → default.
- **Migration:** `workspace_id` columns on swarm/step; existing rows `NULL`.
- **Re-root removal:** `activateForSession` no longer mutates global state; the
  original swarm "no grants" bug does not reproduce.
- **Git gate preview** uses the dispatch's effective root.

## Risks / open points

- Spawning a process per distinct root costs startup time on first use; the LRU
  pool amortizes it and the cap bounds resource use.
- Policy parity depends on `rootedConfigs` carrying the same `toolPolicies` as
  the builtin config — covered by a test.
- This spec touches the registry, dispatch, swarm, and a few routes/frontend
  cleanups; it is one cohesive subsystem (race-free rooting) → one plan.
