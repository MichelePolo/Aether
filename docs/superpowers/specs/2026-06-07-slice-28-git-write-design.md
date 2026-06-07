# Slice 28 — Git Write Actions (Tier 2) — design

> Agent-initiated git **write** actions exposed as a builtin MCP server
> (`aether-git`), gated through the existing breakpoint machinery (slice 22) with
> a git diff preview before execution. Builds on slice 27 (read-only Git
> Swimlanes: `server/domain/git/` no-shell allowlisted runner + `GitService`) and
> slice 22 (breakpoints / ApprovalGate / PreviewService).
>
> Read-only foundation (slice 27) already shipped. This slice adds **Tier 2
> (write)** of the Git integration roadmap. Tier 3 (remote: push/pull/fetch)
> remains future work.

## 1. Brainstorming decisions (locked)

- **Initiator = the agent, via a builtin MCP server.** Git writes become real MCP
  tool calls inside the dispatch loop, so they flow through the **existing**
  breakpoint gate with **zero new gating infrastructure**. (Not UI buttons.)
- **Toolset = read + write.** Read tools let the agent inspect before acting:
  `git_status`, `git_diff` (safe→auto). Write tools: `git_add`, `git_commit`,
  `git_checkout`, `git_restore` (dangerous→gate).
- **All writes gate by default.** Extend the breakpoint dangerous-name pattern so
  every `Git.git_{add,commit,checkout,switch,restore}` is classified dangerous
  (→ gate). Reads stay safe (→ auto). User can relax individual tools via the
  existing per-tool sticky-approve.
- **Preview = Approach 1 (in-process via slice-27 GitService).** When a write
  gate fires, `PreviewService` (main process) computes the relevant git diff
  itself against the workspace git-root and returns a new `gitDiff` preview kind,
  rendered with the slice-27 unified-diff renderer. No MCP round-trip, no shell.

## 2. What we reuse vs. build

**Reused untouched** (the payoff of the MCP-tools choice):
`gateExecuteAndTrace`, `breakpointService.resolveDecision`, `mcpRegistry.awaitDecision`/
`resolveDecision`, the `tool_call_request` SSE event, `POST /api/mcp/decision`, the
60s countdown, sticky-approve, the ApprovalGate modal shell, the builtin MCP
lifecycle (`startBuiltin`/`reconnectBuiltin`), and the slice-27 `runGit` runner +
`GitService` + diff renderer (`classifyDiffLine`).

**Built / changed:** the `aether-git` MCP server + handler; runner allowlist
extension; `BuiltinTransport` + migration + `toConfigs` git branch + auto-rooting;
dangerous-pattern extension; `PreviewService` git branch + new `gitDiff` kind;
ApprovalGate rendering of `gitDiff`; the BuiltinMcpToggles git row.

## 3. Architecture & components

### 3.1 MCP server — `server/mcp/builtin/aether-git.ts`
Mirror of `aether-shell.ts`: a standalone Node process speaking JSON-RPC 2.0 over
stdio. Reads its working directory from `process.argv[2]` (the git-root passed by
`toConfigs`). `tools/list` returns:

| Tool | Kind | inputSchema (required) | git invocation |
|---|---|---|---|
| `git_status` | read | — | `status --porcelain=v2 --branch` |
| `git_diff` | read | `{ staged?: boolean, path?: string }` | `diff [--cached] [-- <path>]` |
| `git_add` | write | `{ paths: string[] }` | `add -- <paths>` |
| `git_commit` | write | `{ message: string }` | `commit -m <message>` |
| `git_checkout` | write | `{ branch: string, create?: boolean }` | `checkout [-b] <branch>` |
| `git_restore` | write | `{ paths: string[], staged?: boolean }` | `restore [--staged] -- <paths>` |

`tools/call` dispatches to handler functions; unknown tool → JSON-RPC `-32601`;
bad args → `-32602` (mirrors aether-shell).

### 3.2 Handler — `server/mcp/builtin/aether-git.handler.ts`
Pure functions, one per tool, each building an **explicit argv array** and calling
the shared `runGit(args, cwd)` from `@/server/domain/git/git.runner` (same-codebase
import in the subprocess, as `aether-shell.handler` imports `builtin.types`).
Returns the MCP `{ isError, content:[{type:'text',text}] }` shape.

Input validation (defense in depth, on top of `shell:false`):
- `paths`/`branch` must not start with `-`; pathspecs always after `--`.
- `message` passed as its own argv element (never interpolated).
- empty `paths` array → error before invoking git.
- non-zero git exit → `isError:true` with stdout+stderr (e.g. "nothing to commit").

### 3.3 Runner allowlist — `server/domain/git/git.runner.ts`
Extend `GIT_SUBCOMMANDS` from `{log, show, rev-parse}` to also include
`{status, diff, add, commit, checkout, switch, restore}`. Invariants unchanged:
`spawn('git', [...fixedFlags, ...args], { shell: false })`, output cap, timeout
cascade, cwd validation. The allowlist is the union of what any caller may run; the
slice-27 read API still only ever passes read subcommands.

### 3.4 cwd auto-rooting (reuse the filesystem pattern)
- `BuiltinTransport`: `'filesystem' | 'terminal'` → add `'git'`
  (`server/domain/mcp/builtin/builtin.types.ts` + `src/types/mcp.types.ts`).
- **Migration** `012_builtin_git.sql` (append-only; next free number): SQLite cannot alter a CHECK
  constraint in place, so rebuild the table — create `builtin_mcp_state_new` with
  `CHECK (transport IN ('filesystem','terminal','git'))`, copy rows, drop old,
  rename, then `INSERT ('git', 0, NULL)`. Done inside the migration transaction.
- `BuiltinMcpStore.toConfigs()`: add a `git` branch returning
  `{ id:'builtin:git', name:'Git', transport:'stdio', command: process.execPath,
  args: [resolveAetherGitArgs(), r.fsRoot ?? defaultCwd], ... }` where
  `resolveAetherGitArgs()` mirrors `resolveAetherShellArgs()` (dist `.js` in prod,
  `--import tsx` `.ts` in dev). The git-root reuses the existing `fs_root` column
  (generic "root per builtin").
- `activate-for-session` (`workspaces.routes.ts`): in addition to re-rooting
  filesystem, re-root git when enabled — `setFsRoot('git', targetRoot)` +
  `reconnectBuiltin('git')`. The git-root tracks the active session's workspace,
  exactly like the filesystem root.

### 3.5 Classification — `server/domain/mcp/breakpoints/breakpoints.types.ts`
Extend the git dangerous pattern:
`/^[^.]+\.git_(rebase|push|reset)/i` →
`/^[^.]+\.git_(rebase|push|reset|add|commit|checkout|switch|restore)/i`.
Result: `Git.git_{add,commit,checkout,restore}` → dangerous → gate;
`Git.git_{status,diff}` → not matched → safe → auto.

### 3.6 Preview — `server/domain/mcp/breakpoints/preview.service.ts`
- New `PreviewResult` variant in `breakpoints.types.ts`:
  `{ kind: 'gitDiff'; unified: string; title: string }`.
- `PreviewService` gains a `GitService` dependency and reads the git-root from
  `BuiltinMcpStore` (`read().find(r => r.transport==='git')?.fsRoot`).
- In `previewToolCall`, when `qualifiedName` matches `^[^.]+\.git_` and a git-root
  exists, compute the preview per action:
  - `git_commit` → `git diff --cached` → title "Commit preview (staged changes)".
  - `git_add(paths)` → `git diff -- <paths>` → title "Will be staged".
  - `git_restore(paths)` → `git diff [--staged] -- <paths>` → title
    "Changes that will be DISCARDED".
  - `git_checkout` → `{ kind:'plain' }` (branch switch is not a file diff).
- Any failure (no root, not a repo, diff error) → **degrade to `{ kind:'plain' }`**;
  preview must never block the gate.

### 3.7 Frontend
- `src/types/mcp.types.ts`: `BuiltinTransport` += `'git'`.
- `BuiltinMcpToggles.tsx`: `ROW_ORDER` += `'git'`, `LABEL.git = 'Git'`. The git row
  is a plain toggle (no manual root input; it auto-roots like Terminal). The
  store (`builtinMcp.store.ts`) is already transport-generic.
- `ApprovalGate.tsx`: render the new `gitDiff` kind using the slice-27 unified-diff
  renderer. Extract a small shared `<UnifiedDiff unified=… title=… />` component out
  of `GitDiffPanel` (so the History view and the gate render unified diffs
  identically) and use it here. The rest of the modal
  (countdown, sticky-approve, approve/reject) is unchanged. `breakpointsApi.preview`
  and `useToolCallDecisions` are already generic and need no change.

## 4. Data flow (gated sequence, end to end)

1. Agent emits `function_call` `Git.git_commit { message }` during dispatch.
2. `gateExecuteAndTrace` emits SSE `tool_call_request`;
   `breakpointService.resolveDecision` classifies it dangerous → `gate`.
3. Frontend `useToolCallDecisions` → `breakpointsApi.preview({ qualifiedName, args })`
   → `PreviewService` runs `git diff --cached` on the git-root →
   `{ kind:'gitDiff', unified, title:'Commit preview (staged changes)' }`.
4. `ApprovalGate` shows the unified diff + commit message + 60s countdown +
   approve/reject.
5. Approve → `POST /api/mcp/decision { callId, action:'approve' }` → resolves
   `mcpRegistry.awaitDecision` → dispatch executes → `callTool('Git.git_commit',
   args)` → `aether-git` subprocess → `git commit -m <message>` in the git-root →
   result back via SSE.
6. `ReasoningTracer` records the step; user/model messages persist to history.

Steps 2, 4, 5, 6 are existing machinery. New: the MCP server (step-5 target),
classification (step 2), preview content (step 3).

## 5. Error handling & edge cases

- **Nothing staged on `git_commit`** → git non-zero "nothing to commit" →
  `isError:true` with the message; the agent can recover (not a crash).
- **Builtin git enabled but no active workspace / not a repo** → git-root null or
  non-repo → handler returns explicit error ("no git repository rooted") rather
  than running in an arbitrary dir.
- **Preview failure** → degrade to `{ kind:'plain' }`; the gate still opens with
  the args. Preview never blocks approval.
- **Decision timeout (60s)** → existing behavior: auto-reject, tool not executed.
- **Destructive guards**: `git_restore`/`git_checkout` validate paths/branch (no
  leading `-`, pathspec after `--`); `git_restore` gets the most explicit preview
  title.
- **Runner safety**: `shell:false` + allowlist + separate argv stay invariant;
  extending the allowlist introduces no shell-injection surface (message/paths are
  always distinct argv, never interpolated).

## 6. Testing

- **Handler** `aether-git.handler.test.ts`: deterministic temp-repo fixture (as in
  slice 27). Per tool: `git_status`/`git_diff` (read); `git_add` (verify staged via
  `git diff --cached`); `git_commit` (verify new commit + message); `git_checkout`
  with `create` (new branch) and switch; `git_restore` (discards). Assert repo
  state with follow-up git commands. Error cases: empty paths, nothing-to-commit,
  non-repo cwd.
- **Runner**: write subcommands now allowed; a non-allowlisted subcommand still
  rejected (status 400).
- **Classification**: `Git.git_{commit,add,checkout,restore}` → dangerous;
  `Git.git_{status,diff}` → safe.
- **PreviewService**: `Git.git_commit` → `gitDiff` with staged content;
  degrades to `plain` with no root / non-repo.
- **BuiltinMcpStore + migration**: `toConfigs()` includes git when enabled; CHECK
  accepts `'git'` and the row exists after migration.
- **Frontend**: `ApprovalGate` renders the `gitDiff` kind (RTL smoke);
  `BuiltinMcpToggles` shows the Git row.
- **E2e (decided at plan time)**: a single happy-path is possible by driving a Fake
  provider dispatch that emits a git tool call and auto-approving; heavier, so it
  may be deferred or kept minimal.

## 7. Out of scope (future slices)

- **Tier 3 (remote)**: `push` / `pull` / `fetch`, fast-forward `merge` with conflict
  surfacing.
- **High-risk**: interactive `rebase`, `cherry-pick`, conflict resolution,
  `reset --hard`, history rewrite (already gated as dangerous if ever added).
- **UI-initiated git writes** (a "Changes pane" with stage/commit buttons): a
  separate later slice; this slice is agent-initiated only.

## 8. Delivery checklist

- [ ] `server/mcp/builtin/aether-git.{ts,handler.ts}` + handler tests
- [ ] `git.runner.ts` allowlist extension + test
- [ ] migration `NNN_builtin_git.sql` (table rebuild) + store/migration tests
- [ ] `BuiltinTransport` (`server` + `src/types`), `toConfigs()` git branch,
      `resolveAetherGitArgs()`, `activate-for-session` git re-rooting
- [ ] `breakpoints.types.ts` dangerous-pattern extension + classification test
- [ ] `PreviewService` git branch + `gitDiff` `PreviewResult` kind + test
- [ ] `ApprovalGate` `gitDiff` rendering; `BuiltinMcpToggles` git row
- [ ] `npm run lint` + `npm run test:run` green; `npm run build` OK
- [ ] roadmap: Git integration Tier 2 → shipped
