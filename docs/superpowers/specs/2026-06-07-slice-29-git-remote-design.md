# Slice 29 — Git Remote Actions (Tier 3) — design

> Agent-initiated git **remote** actions (`fetch`, `push`, `pull --ff-only`,
> `merge --ff-only`) added to the builtin `aether-git` MCP server, gated through the
> existing breakpoint machinery (slice 22) with a **commit-list** preview. Authentication
> is **ambient** (the host's existing git credentials); Aether stores no credentials.
> Builds directly on slice 28 (Tier 2 write actions) and slice 27/22.
>
> Read-only (slice 27, Tier 1) and write (slice 28, Tier 2) are shipped. This is **Tier 3
> (remote)** of the Git integration roadmap. After this, the remaining roadmap items are
> the high-risk "Deferred" bucket (interactive rebase, cherry-pick, conflict resolution,
> reset --hard, history rewrite → escalate to human).

## 1. Brainstorming decisions (locked)

- **Scope:** `fetch`, `push`, `pull` (fast-forward-only), `merge` (fast-forward-only).
- **Initiator:** the agent, via new tools on the existing builtin `aether-git` MCP server
  (same model as Tier 2 — real MCP tool calls flow through the existing gate).
- **Auth = ambient host git auth.** The spawned git inherits `process.env`, so SSH agent /
  credential helper / token-in-remote-URL work as configured on the host. Aether stores no
  git credentials. `GIT_TERMINAL_PROMPT=0` is set on remote spawns so missing credentials
  **fail fast** instead of blocking on an interactive prompt.
- **Remote target = name only, never a URL.** Tool args (`remote`/`branch`/`ref`) must match
  `^[\w./-]+$`; this charset excludes `:` and thus rejects URLs (`https://…`, `git@host:…`),
  enforcing that the agent can only target a remote that already exists in the repo config.
- **Merge/pull = `--ff-only`.** On divergence, git aborts cleanly (working tree untouched)
  and the tool reports the failure → escalate to human. No conflict markers, no half-merged
  state. Never `--force` on push.
- **Preview = `commitList` kind.** Remote ops move commits, not files; the gate shows the
  outgoing/incoming commit list, not a squashed file diff.

## 2. What we reuse vs. build

**Reused untouched:** the entire breakpoint gate (classify → gate → await → ApprovalGate →
execute → SSE), the slice-28 `aether-git` MCP server lifecycle + cwd auto-rooting, the
slice-27 `runGit` runner (extended), and the `PreviewService` plumbing.

**Built / changed:** 4 new MCP tools (handler + server `tools/list`/dispatch); runner
allowlist + per-call `maxTimeoutMs` + `GIT_REMOTE_DEFAULTS`; `GIT_TERMINAL_PROMPT=0` on
remote spawns; dangerous-pattern extension (`push|pull|merge`; `fetch` stays safe); a new
`commitList` `PreviewResult` kind (server + frontend) + its `PreviewService` branch + its
ApprovalGate rendering.

## 3. Architecture & components

### 3.1 Runner — `server/domain/git/git.runner.ts` + `git.types.ts`
- Extend `GIT_SUBCOMMANDS` with `fetch`, `push`, `pull`, `merge`.
- `git.types.ts`: add `export const GIT_REMOTE_DEFAULTS = { timeoutMs: 60_000, maxTimeoutMs: 120_000 } as const;`
- `runGit(args, cwd, opts?)` gains `opts.maxTimeoutMs` and `opts.env`:
  - Effective timeout becomes `Math.min(opts?.timeoutMs ?? GIT_DEFAULTS.timeoutMs, opts?.maxTimeoutMs ?? GIT_DEFAULTS.maxTimeoutMs)` — so remote callers can raise the ceiling above the local 30s.
  - Spawn env becomes `{ ...process.env, ...opts?.env }` so remote handlers can inject `GIT_TERMINAL_PROMPT: '0'`.
  - All other invariants unchanged (`shell:false`, argv array, cwd validation, output cap, SIGTERM→SIGKILL).

### 3.2 Handler — `server/mcp/builtin/aether-git.handler.ts`
Add a `badRef` guard: `(s) => typeof s !== 'string' || s.length === 0 || !/^[\w./-]+$/.test(s)` (rejects empty, leading `-`, and any `:` → no URLs). Add a remote-op runner wrapper that passes the remote timeout + `GIT_TERMINAL_PROMPT=0`:

```ts
const REMOTE_ENV = { GIT_TERMINAL_PROMPT: '0' };
function runRemote(args: string[], cwd: string): Promise<GitToolResult> {
  return run(args, cwd, { timeoutMs: GIT_REMOTE_DEFAULTS.timeoutMs, maxTimeoutMs: GIT_REMOTE_DEFAULTS.maxTimeoutMs, env: REMOTE_ENV });
}
```
(`run` is the slice-28 wrapper; extend it to forward an opts arg to `runGit`.)

Tools:
- `git_fetch({ remote? })` → default `origin`; validate via `badRef`; `runRemote(['fetch', remote], cwd)`.
- `git_push({ remote?, branch?, setUpstream? })` → default remote `origin`; if `branch` given validate it, else use `HEAD`; args `['push', ...(setUpstream ? ['-u'] : []), remote, branch ?? 'HEAD']`. Never `--force`.
- `git_pull({ remote?, branch? })` → `['pull', '--ff-only', remote, ...(branch ? [branch] : [])]`.
- `git_merge({ ref })` → require `ref` (validate); `['merge', '--ff-only', ref]`.

### 3.3 Server — `server/mcp/builtin/aether-git.ts`
Add the 4 tools to `TOOLS` (with `inputSchema`) and 4 `case`s in the `tools/call` switch dispatching to the handlers. (Thin, untested, mirrors existing pattern.)

### 3.4 Classification — `server/domain/mcp/breakpoints/breakpoints.types.ts`
Extend the git dangerous pattern to include `pull` and `merge` (push already present):
`/^[^.]+\.git_(rebase|push|reset|add|commit|checkout|switch|restore|pull|merge)/i`.
**`fetch` is intentionally NOT added** → it stays `safe` (auto): it only updates local
remote-tracking refs (no working-tree or remote mutation). This is policy-relaxable/
tightenable by the user via the existing breakpoints policy + per-tool sticky-approve.

### 3.5 Preview — `commitList` kind
- New `PreviewResult` variant in `server/domain/mcp/breakpoints/breakpoints.types.ts` AND the
  frontend mirror `src/types/breakpoints.types.ts`:
  `{ kind: 'commitList'; title: string; commits: string[] }`.
- `PreviewService` (already has `gitRoot`): add a branch for remote write tools
  (`^[^.]+\.git_(push|pull|merge)$`):
  - `git_push`: resolve current branch (`rev-parse --abbrev-ref HEAD`) and remote (arg or
    `origin`); run `git log <remote>/<branch>..HEAD --oneline --no-color` → outgoing commits;
    title `Push N commits → <remote>/<branch>`.
  - `git_pull`/`git_merge`: incoming commits `git log HEAD..<ref> --oneline` where `<ref>` is
    the merge ref or `<remote>/<branch>`; title `Will merge N commits`.
  - Any failure (no upstream, unknown ref) → degrade to `{ kind: 'plain' }`.
  - `git_fetch` is not previewed (it's safe→auto, never gated).
- `ApprovalGate.tsx`: render `commitList` (a titled list of monospace commit lines), reusing
  the existing modal chrome.

## 4. Data flow (gated push, end to end)

1. Agent emits `Git.git_push { remote: 'origin' }`.
2. `resolveDecision` classifies `Git.git_push` dangerous → `gate`.
3. `PreviewService` runs `git log origin/<branch>..HEAD --oneline` →
   `{ kind:'commitList', title:'Push 3 commits → origin/main', commits:[…] }`.
4. `ApprovalGate` shows the commit list + 60s countdown + approve/reject.
5. Approve → `git push origin HEAD` with `GIT_TERMINAL_PROMPT=0` and the 60s remote timeout,
   in the git-root → result via SSE.
`fetch` (safe→auto) skips the gate entirely.

## 5. Error handling & edge cases

- **Missing/wrong credentials** → with `GIT_TERMINAL_PROMPT=0`, git exits non-zero with the
  auth error → `isError` surfaced (no hang to timeout).
- **Push rejected (non-ff)** → git rejects (`updates were rejected`) → `isError`. Never force;
  the agent must pull first.
- **Divergent pull/merge** → `--ff-only` aborts cleanly, working tree intact → `isError`
  ("Not possible to fast-forward") → escalate to human.
- **Unknown remote** → git error (URLs already excluded by the `^[\w./-]+$` charset upstream).
- **Network timeout** → runner SIGTERM→SIGKILL → `GIT_TIMEOUT` (504).
- **Preview without upstream** (branch never pushed, no `origin/<branch>`) → degrade to
  `plain`; the gate still opens.
- **Runner safety invariants** unchanged: `shell:false` + argv + allowlist; remote/branch/ref
  are validated argv, no injection surface.

## 6. Testing

**No real network** (the environment has none): tests use a **local bare repo as a fake
`origin`** — git push/pull/fetch between local repos need no credentials.

- **Handler** (`aether-git.handler.test.ts`, extend the existing file): fixture = a work repo
  with a bare repo added as `origin`. Cover: `git_fetch` updates the tracking ref; `git_push`
  sends commits (verify with `git -C <bare> log`); `git_pull --ff-only` fast-forwards;
  `git_pull` on a diverged branch → `isError`; `git_merge --ff-only`; validation (a `remote`
  containing `:` or starting with `-` → error).
- **Runner**: remote subcommands are allowlisted; `opts.maxTimeoutMs` raises the clamp;
  `opts.env` is merged into the spawn env.
- **Classification**: `Git.git_{push,pull,merge}` → dangerous; `Git.git_fetch` → safe.
- **PreviewService**: `git_push` → `commitList` with the outgoing commits (against the bare
  remote); degrades to `plain` without an upstream.
- **Frontend**: `ApprovalGate` renders the `commitList` kind (RTL smoke).

## 7. Out of scope (future)

Force push, `push --tags`, arbitrary-URL remotes, **vault-managed git credentials** (auth
stays ambient), real merge-conflict resolution, `rebase`/`cherry-pick`, history rewrite.

## 8. Delivery checklist

- [ ] `git.runner.ts` allowlist (`fetch/push/pull/merge`) + `opts.maxTimeoutMs`/`opts.env`;
      `git.types.ts` `GIT_REMOTE_DEFAULTS` + tests
- [ ] `aether-git.handler.ts` 4 remote handlers + `badRef` + `runRemote` (`GIT_TERMINAL_PROMPT=0`) + tests
- [ ] `aether-git.ts` server: 4 tools in `tools/list` + dispatch
- [ ] `breakpoints.types.ts` dangerous pattern += `pull|merge`; `commitList` `PreviewResult` (server + `src/types`)
- [ ] `preview.service.ts` `commitList` branch + tests
- [ ] `ApprovalGate.tsx` `commitList` rendering
- [ ] `npm run lint` + `npm run test:run` green; `npm run build` OK
- [ ] roadmap: Git integration Tier 3 → shipped
