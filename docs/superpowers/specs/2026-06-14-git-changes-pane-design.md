# Git Changes Pane — design

> A UI-initiated working-tree source-control view (like VS Code's Source Control):
> the **human-driven** counterpart to the read-only History view (slice 27) and the
> agent-initiated git write tools (slices 28/29). Shows uncommitted changes
> (staged / unstaged / untracked / conflicted), per-file diff, and lets the human
> stage/unstage, discard, commit, and commit & push. Reuses the slice-27 `GitService`
> + runner (no runner change — `status/diff/add/commit/restore/push` already
> allowlisted) and the shared `UnifiedDiff` renderer.
>
> Builds on: Git Swimlanes (slice 27), Git write (slice 28), Git remote (slice 29) —
> all shipped on `main`. This is the deliberately-deferred **UI-initiated** half of
> the Git integration ("Changes pane" follow-up noted in the roadmap).

## 1. Brainstorming decisions (locked)

- **Initiator = the human, in a UI.** Because the user explicitly authors the message
  and clicks the action, these mutations do **NOT** route through the slice-22 breakpoint
  gate (the gate is for agent tool calls; the human's click is the consent). Destructive
  **discard** gets its own confirmation dialog.
- **Navigation = sub-tabs inside the git view.** `mainView` becomes `'chat' | 'git'`
  (rename of the old `'history'`), and the git view hosts an internal
  `[ History | Changes ]` tab bar.
- **Scope = full source control:** read (file lists + per-file diff), stage/unstage
  (per-file and all), **discard** (tracked working-tree, with confirm), **commit**, and
  **commit & push** (reusing the slice-29 ambient-auth push).
- **Data model = server-parsed porcelain v2 + per-file diff on demand** (Approach 1):
  the server parses `git status --porcelain=v2` into a structured `WorkingChanges`; the
  per-file diff is fetched when a file is selected. Mirrors the History view's
  list-then-diff pattern.
- **Dedicated store.** A new `gitChanges.store` (single responsibility), separate from
  the History `git.store`.

## 2. What we reuse vs. build

**Reused untouched:** the git runner + its allowlist (`status/diff/add/commit/restore/push`
already permitted), `GitService`'s `resolveCwd` (workspace rooting) and path validation,
the slice-29 push safety (`GIT_TERMINAL_PROMPT=0`, configured-remote, never `--force`), the
shared `UnifiedDiff` + `classifyDiffLine`, `GitEmptyState`, and `useDialog` (confirm).

**Built:** a pure porcelain-v2 parser; `GitService` working-tree methods; new HTTP routes;
api-client methods; a dedicated `gitChanges.store`; the `GitView` tab wrapper + `ChangesView`;
the `mainView 'history' → 'git'` rename + internal tab state.

## 3. Architecture & components

### 3.1 Porcelain parser — `server/domain/git/status-parse.ts`
A pure function `parseStatusPorcelain(text: string): WorkingChanges`, unit-tested in
isolation. Reads `git status --porcelain=v2 --branch` output:
- header lines: `# branch.head <name>` → `branch`; `# branch.ab +<a> -<b>` → `ahead`/`behind`.
- `1 <XY> ...<path>` (ordinary): `X` = staged status, `Y` = unstaged status. A non-`.` `X`
  → entry in `staged`; a non-`.` `Y` → entry in `unstaged`. Status letters: `M`/`A`/`D`/`T`.
- `2 <XY> ... <path>\t<origPath>` (rename/copy): same X/Y split; carries `oldPath`.
- `u ...` (unmerged) → `conflicted`.
- `? <path>` (untracked) → `untracked`.

```ts
type WorkingFileStatus =
  | 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange'
  | 'untracked' | 'conflicted';
interface WorkingFile { path: string; oldPath?: string; status: WorkingFileStatus; }
interface WorkingChanges {
  staged: WorkingFile[];
  unstaged: WorkingFile[];
  untracked: WorkingFile[];
  conflicted: WorkingFile[];
  branch?: string;
  ahead?: number;
  behind?: number;
}
```

### 3.2 GitService — new working-tree methods (`server/domain/git/git.service.ts`)
All reuse `runGit` + the existing `resolveCwd` + path validation (`hash`/`-`-leading guards).
- `changes(workspaceId): Promise<WorkingChanges>` → `runGit(['status','--porcelain=v2','--branch'], cwd)` → `parseStatusPorcelain`.
- `workingDiff(workspaceId, { path, staged }): Promise<DiffResult>` → `git diff [--cached] -- <path>` (validate `path`).
- `stage(workspaceId, { paths }): Promise<void>` → `git add -- <paths>`.
- `unstage(workspaceId, { paths }): Promise<void>` → `git restore --staged -- <paths>`.
- `discard(workspaceId, { paths }): Promise<void>` → `git restore -- <paths>` (tracked only).
- `commit(workspaceId, { message }): Promise<{ head: string }>` → `git commit -m <message>`, then `rev-parse --short HEAD`. Reject empty/whitespace message.
- `push(workspaceId, { remote?, branch? }): Promise<{ stdout: string }>` → same safety as the
  slice-29 push: default remote `origin`, validate against configured remotes
  (`git remote` membership), `GIT_TERMINAL_PROMPT=0`, remote timeout, **never `--force`**; push
  current branch (`HEAD`) by default. The configured-remote check currently lives in
  `aether-git.handler.ts`; the plan should **extract it into a shared helper**
  (e.g. `server/domain/git/remote-guard.ts`) reused by both the MCP handler and `GitService`,
  rather than duplicating it.

Each `paths` entry is validated (non-empty string, not starting with `-`) before the call;
empty `paths` → error.

### 3.3 Routes — `server/routes/git.routes.ts`
Add to `createGitRoutes` (Zod-validated, `asyncHandler`):
| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/api/git/changes` | `workspaceId` | `WorkingChanges` |
| GET | `/api/git/working-diff` | `workspaceId`, `path`, `staged?` | `text/plain` |
| POST | `/api/git/stage` | `{ workspaceId, paths }` | `204` |
| POST | `/api/git/unstage` | `{ workspaceId, paths }` | `204` |
| POST | `/api/git/discard` | `{ workspaceId, paths }` | `204` |
| POST | `/api/git/commit` | `{ workspaceId, message }` | `{ head }` |
| POST | `/api/git/push` | `{ workspaceId }` | `{ stdout }` |

POST routes need the JSON body parser — the git routes mount under `/api/git` after the
global `express.json()` in `app.ts`, so JSON bodies are available (verify mount order).
These are human-initiated → **no breakpoint gate**.

### 3.4 Frontend
- `src/lib/api/git.api.ts` — add `changes`, `workingDiff`, `stage`, `unstage`, `discard`,
  `commit`, `push`.
- `src/stores/gitChanges.store.ts` (new, Zustand):
  ```ts
  interface GitChangesState {
    changes: WorkingChanges | null;
    selectedPath: string | null;
    selectedStaged: boolean;
    selectedDiff: string | null;
    message: string;
    loading: boolean; busy: boolean; error: string | null;
    activeWorkspaceId: string | null;
    load(workspaceId): Promise<void>;
    select(path, staged): Promise<void>;     // fetch workingDiff
    stage(paths): Promise<void>;             // then refresh
    unstage(paths): Promise<void>;
    discard(paths): Promise<void>;           // caller confirms first
    setMessage(m): void;
    commit(): Promise<void>;                  // then refresh + clear message
    commitAndPush(): Promise<void>;           // commit then push
    refresh(): Promise<void>;
    reset(): void;
  }
  ```
  Every mutation re-fetches `changes` (auto-refresh). `busy` guards concurrent actions.
- `src/stores/ui.store.ts` — `MainView` becomes `'chat' | 'git'`; on `initFromStorage`,
  migrate a persisted `'history'` value to `'git'`. Add `gitTab: 'history' | 'changes'`
  (persisted) + `setGitTab`.
- `src/components/git/GitView.tsx` (new) — header tab bar `[ History | Changes ]` (bound to
  `gitTab`); renders `GitSwimlanesView` or `ChangesView`. `App.tsx` renders `<GitView/>` when
  `mainView === 'git'`. `TopBar` toggle label/icon updated (git ↔ chat).
- `src/components/git/ChangesView.tsx` (new) — left: sections **Staged / Changes / Untracked
  / Conflicts**, each a list of file rows (icon by status, path, per-row actions:
  stage ⊕ / unstage ⊖ / discard ↺); a section-level "stage all" / "unstage all". Right: the
  selected file's `UnifiedDiff`. Bottom: a commit message textarea + **Commit** and
  **Commit & Push** buttons (Commit disabled when nothing staged or message empty). Discard
  actions call `useDialog().confirm` first. Conflicts section is read-only.

## 4. Data flow (stage → commit & push)

1. `ChangesView` mounts (or the workspace changes) → `gitChanges.load(workspaceId)` →
   `GET /changes` → file lists + branch/ahead/behind.
2. User clicks a file → `select(path, staged)` → `GET /working-diff` → `UnifiedDiff` on the right.
3. User clicks stage on a row → `POST /stage {paths:[path]}` → store re-fetches `changes`.
4. User types a message + **Commit** → `POST /commit {message}` → re-fetch (now clean) +
   clear message.
5. **Commit & Push** → `POST /commit` then `POST /push` → re-fetch + updated `ahead`/`behind`.

Steps reuse the History view's list-then-diff pattern; no breakpoint gate anywhere.

## 5. Error handling & edge cases

- **No workspace / not a repo** → `GitEmptyState` ("no workspace" / "not a git repository").
- **Commit with nothing staged** → Commit button disabled (UI guard) + service rejects empty
  index ("nothing to commit") surfaced inline.
- **Discard** (destructive) → confirm dialog first ("Discard changes in N file(s)? This cannot
  be undone."). Tracked changes only (`git restore`); untracked-file deletion is out of scope.
- **Push failure** (missing auth / non-ff rejection) → `GIT_TERMINAL_PROMPT=0` fails fast →
  inline error banner. The commit already landed (ahead++); push is retryable. Never `--force`.
- **Conflicted (unmerged) files** → shown read-only with a badge; no stage/commit actions in v1.
- **Path safety** → every path validated (non-empty, no leading `-`, pathspec after `--`);
  runner invariants (`shell:false`, allowlist) unchanged.
- **Refresh races** → each mutation re-fetches; if the selected file disappears after an
  action, the diff pane clears gracefully.

## 6. Testing

- **Parser** `status-parse.test.ts`: porcelain-v2 fixtures — modified, staged, both-staged-and-
  modified, untracked, renamed (`2` with score), deleted, conflicted (`u`), branch header +
  ahead/behind, clean repo (all empty).
- **GitService** (extend the temp-repo fixture test): `changes()` reflects staged/unstaged/
  untracked after edits; `stage`/`unstage`/`discard`/`commit` mutate correctly (verified with
  control git commands); `workingDiff` with/without `--cached`; `push` to a local bare remote.
- **Routes**: each new endpoint — 200 happy-path, 400 validation (missing path/message), 404
  unknown workspace.
- **Store** `gitChanges.store.test.ts` (mock api): load, stage→refresh, commit→clear-message,
  discard, commitAndPush, error handling, busy guard.
- **Components**: RTL smoke for `ChangesView` (sections render; Commit disabled when nothing
  staged) and `GitView` (tab switch).
- **E2e (Playwright)**: deferred (heavy setup), same rationale as slices 28/29; covered by
  unit/integration + manual smoke.

## 7. Out of scope (v1, future follow-ups)

Untracked-file deletion (`git clean`), merge-conflict resolution, hunk-level (partial) staging,
commit `--amend`, `.gitignore` editing, a file-watcher for live auto-refresh (v1 refreshes on
action + a manual refresh button).

## 8. Delivery checklist

- [ ] `status-parse.ts` pure parser + tests
- [ ] `GitService` working-tree methods (`changes/workingDiff/stage/unstage/discard/commit/push`) + tests
- [ ] `git.routes.ts` new endpoints (GET changes/working-diff, POST stage/unstage/discard/commit/push) + tests
- [ ] `git.api.ts` client methods
- [ ] `gitChanges.store.ts` + tests
- [ ] `ui.store` `mainView 'history'→'git'` migration + `gitTab` + tests
- [ ] `GitView` tab wrapper + `ChangesView`; `App.tsx`/`TopBar` wiring
- [ ] i18n strings; a11y (focus, aria on tabs/actions)
- [ ] `npm run lint` + `npm run test:run` green; `npm run build` OK
- [ ] roadmap: mark the Changes pane shipped
