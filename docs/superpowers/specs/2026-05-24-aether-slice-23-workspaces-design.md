# Aether Slice 23 — Native Workspace Management GUI (design spec)

**Date:** 2026-05-24
**Branch:** `feat/slice-23-workspaces`
**Roadmap entry:** docs/superpowers/roadmap.md → "Slice 23 — Native Workspace Management GUI"

## Goal

Give the user a managed list of project folders ("workspaces"), one of which is active *per session*. Switching sessions reroots the Filesystem MCP (slice 21) to that session's workspace `rootPath`. Workspaces are picked via a server-side file-browser modal so the user gets a native-feeling experience without browser-API impedance mismatch.

## Scope decisions

| Decision | Choice |
|---|---|
| Picker UX | Custom server-side file browser modal (`GET /api/workspaces/browse?path=…`). Browser-native pickers can't return host paths, so we render our own. |
| Active-workspace scope | **Per session**. Each `sessions` row carries an optional `workspace_id`. Switching the focused session reroots the Filesystem MCP. Background sessions share the active root (single MCP process — documented constraint). |
| Workspace shape | `{ id, name, rootPath, addedAt }`. Unique on `rootPath`. |
| New-session inheritance | New sessions copy the current active session's `workspace_id` at creation. |
| Unassigned session | Filesystem MCP stays at `process.cwd()` (current behavior, no break). |
| MCP disabled | Activation calls succeed but skip the reroot. Workspace assignment still persists. |
| Workspace delete | `ON DELETE SET NULL` on sessions.workspace_id (no cascade). |

## Data shapes

```sql
-- server/db/migrations/009_workspaces.sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_workspaces_root_path ON workspaces(root_path);

ALTER TABLE sessions ADD COLUMN workspace_id TEXT
  REFERENCES workspaces(id) ON DELETE SET NULL;
```

```ts
// server/domain/workspaces/workspaces.types.ts
export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  addedAt: number;
}

export interface BrowseEntry {
  name: string;
  isDir: boolean;
}
```

### Routes

```
GET    /api/workspaces                            → { workspaces: Workspace[] }
POST   /api/workspaces           body { name, rootPath }
PATCH  /api/workspaces/:id       body { name }
DELETE /api/workspaces/:id
GET    /api/workspaces/browse?path=/abs/path      → { entries: BrowseEntry[] }
POST   /api/workspaces/activate-for-session
                                 body { sessionId } → { rooted: string | null }
```

The existing `PATCH /api/sessions/:id` (slice 2b — title rename) is extended to also accept `{ workspaceId: string | null }`.

## Architecture

### Server

- **Migration 009** — `workspaces` table + `ALTER TABLE sessions ADD COLUMN workspace_id`.
- **`server/domain/workspaces/workspaces.types.ts`** — `Workspace`, `BrowseEntry`.
- **`server/domain/workspaces/workspaces.store.ts`** — `WorkspacesStore` (SQLite-backed): `list()`, `create({ name, rootPath })`, `rename(id, name)`, `delete(id)`, `get(id)`. `create()` validates the path exists + is a directory (same `fs.statSync` check the builtin-mcp routes use) and surfaces the unique-constraint violation as a clean error.
- **`server/domain/workspaces/filesystem-browser.service.ts`** — `browse(path: string): Promise<BrowseEntry[]>` via `fs.readdir(path, { withFileTypes: true })`. Returns subdirectories only (files filtered out — user picks folders). Sorted alphabetically. Throws on ENOENT / EACCES.
- **`server/domain/history/history.store.ts`** extensions — `createEmpty(opts?: { workspaceId?: string })` writes the FK; `setSessionWorkspace(sessionId, workspaceId | null)` updates it; session reads include `workspaceId`.
- **`server/routes/workspaces.routes.ts`** — the 6 new routes. The `activate-for-session` handler reads the session's `workspace_id`, looks up its `rootPath`, compares to the current `builtin_mcp_state.filesystem.fs_root`, and if different AND filesystem MCP is `enabled`, calls `builtinStore.setFsRoot('filesystem', rootPath)` + `mcpRegistry.reconnectBuiltin('filesystem')`. Returns `{ rooted: rootPath | null }`.
- **`server/routes/sessions.routes.ts`** extension — PATCH accepts `{ workspaceId }` alongside `title`; validates that any non-null workspaceId exists.
- **`server/app.ts`** — `workspacesStore?` + `filesystemBrowser?` in `AppDeps`; mount `/api/workspaces`.
- **`server/index.ts`** — construct `WorkspacesStore` + `FilesystemBrowserService`, wire into `createApp`.

### Frontend

- **`src/types/workspace.types.ts`** — mirror of server types.
- **`src/lib/api/workspaces.api.ts`** — `list`, `create`, `rename`, `remove`, `browse`, `activateForSession`.
- **`src/lib/api/sessions.api.ts`** extension — generalize `renameSession(id, title)` to `updateSession(id, { title?, workspaceId? })`; keep `renameSession` as a thin wrapper.
- **`src/stores/workspaces.store.ts`** — Zustand. State: `workspaces`, `loading`, `error`. Actions: `init()`, `create({name, rootPath})`, `rename(id, name)`, `remove(id)`, `_reset()`. Module-level `Map<string, Promise>` dedupe (same pattern as `providerAuth.store`).
- **`src/stores/sessions.store.ts`** extensions — `setActive(id)` calls `workspacesApi.activateForSession(id)` after the local switch + history hydrate succeeds (non-fatal on error). New `setSessionWorkspace(sessionId, workspaceId | null)` PATCHes + immediately calls `activateForSession`. `createSession()` copies the current active session's `workspaceId` into the POST body so new sessions inherit.
- **`src/stores/ui.store.ts`** — `workspaceBrowserOpen: boolean` + `openWorkspaceBrowser()` / `closeWorkspaceBrowser()`.
- **`src/components/sidebar/WorkspacesSection.tsx`** — sidebar pane below `<BreakpointsSection>`. Each row shows workspace name + truncated rootPath; hover reveals a delete button; row click opens rename dialog (`useDialog().prompt`). Header has `+ Add workspace…` that opens the modal.
- **`src/components/workspaces/WorkspaceBrowserModal.tsx`** — custom file browser. State: `currentPath` (starts undefined → server defaults to `os.homedir()`). Top breadcrumb of path segments (each independently clickable). Body scrollable list of subdirectories from `GET /api/workspaces/browse?path=…`. Each row click descends. Footer: `Name` text input (auto-filled with basename) + "Add this folder" button → `workspacesApi.create({ name, rootPath: currentPath })` → close. Escape / outside-click → cancel.
- **`src/components/topbar/WorkspaceChip.tsx`** — small chip in `<TopBar>` showing the active session's workspace name (or "no workspace"). Click → dropdown listing all workspaces; selecting one calls `sessions.store.setSessionWorkspace(activeId, workspace.id)`.
- **`src/App.tsx`** — mount `<WorkspacesSection />` below `<BreakpointsSection />`; mount `<WorkspaceBrowserModal />` near other modals; mount `<WorkspaceChip />` in `<TopBar />`; call `useWorkspacesStore.getState().init()` on App mount.

### MSW
- `src/test/msw-handlers.ts` — defaults for the 6 new endpoints.

## Data flow

### Add a workspace
1. User clicks `+ Add workspace…` → `ui.openWorkspaceBrowser()`.
2. Modal mounts → `GET /api/workspaces/browse?path=` (server defaults to `os.homedir()`).
3. User navigates by clicking folders or breadcrumb segments.
4. User confirms name + clicks "Add this folder" → `POST /api/workspaces`. Server validates + persists.
5. FE appends to `workspaces.store.workspaces`; modal closes.

### Switch the active session's workspace
1. User opens `<WorkspaceChip>` dropdown, picks a workspace.
2. FE: `sessions.store.setSessionWorkspace(activeId, workspaceId)` → `PATCH /api/sessions/:id { workspaceId }` → `POST /api/workspaces/activate-for-session { sessionId }`.
3. Server reads session's workspace, compares to current `fs_root`, calls `setFsRoot` + `reconnectBuiltin('filesystem')` if different AND filesystem MCP enabled.
4. Filesystem MCP restarts at the new root.

### Switch sessions
1. User clicks a session row → `sessions.store.setActive(newId)`.
2. After local switch + history hydrate, store calls `workspacesApi.activateForSession(newId)`. Same reroot logic. Non-fatal on error.

### New session inherits workspace
1. `+ New session` → `sessions.store.createSession()`.
2. Store reads current active session's `workspaceId`, passes it in `POST /api/sessions { workspaceId }`. Server's `createEmpty({ workspaceId })` writes the FK.
3. After creation, `setActive(newId)` runs the same activation — but the workspace is unchanged, so the server's "if different" check is a no-op.

### Delete a workspace
1. User clicks delete → `useDialog().confirm()`.
2. On confirm: `DELETE /api/workspaces/:id`. `ON DELETE SET NULL` clears `workspace_id` on any session that had it.
3. FE removes from store. If the active session lost its workspace, FE calls `activateForSession(activeId)` again — server sees NULL, leaves `fsRoot` at its current value, returns `{ rooted: null }`. Chip updates to "no workspace".

### Filesystem MCP disabled
- Activation calls always succeed but skip the reroot when filesystem MCP `enabled = false`. Workspace assignment still persists so it's ready when the user enables the MCP.

## Error handling

| Scenario | Server | FE |
|---|---|---|
| `POST /api/workspaces` non-existent path | 400 VALIDATION_ERROR | Banner via store error |
| `POST /api/workspaces` path is a file | 400 "must be a directory" | Banner |
| `POST /api/workspaces` duplicate rootPath | 400 (unique-constraint, surfaced) | Banner |
| `GET /api/workspaces/browse` ENOENT / EACCES | 400 with reason | Modal shows inline error + "Go up" / "Back to home" recovery |
| `GET /api/workspaces/browse` with no `path` | Defaults to `os.homedir()` (falls back to `process.cwd()` if homedir lookup fails) | — |
| `DELETE /api/workspaces/:id` unknown id | 404 | FE removes from store anyway |
| `PATCH /api/sessions/:id { workspaceId: 'bogus' }` | 400 (validate the workspace exists before writing) | `<WorkspaceChip>` reverts |
| `POST activate-for-session` session has `workspace_id = NULL` | No reroot. `{ rooted: null }` | — |
| `POST activate-for-session` filesystem MCP `enabled = false` | No reroot. `{ rooted: null }` | Chip shows "MCP disabled" hint |
| `reconnectBuiltin('filesystem')` fails (path vanished) | 500 with reason; MCP stays at old state | Banner |
| Concurrent `setActive` calls | — | Activation dedupes via module-level `Map<sessionId, Promise>` |
| Workspace's rootPath deleted on disk after creation | Detected on next reconnect; banner. Workspace row stays. | Banner |
| Slice 16 session import brings unknown `workspace_id` | Import sets `workspaceId = NULL`. Documented in envelope schema. | — |

**Security:** `GET /api/workspaces/browse` lists local directories. Aether is a single-user local tool with no auth; anyone reaching `localhost:3000` already has the filesystem MCP + aether-shell. No new attack surface.

**Concurrent-streams constraint:** Multiple sessions can stream concurrently against different workspaces, but the Filesystem MCP is a single stdio process pinned to one root. The *focused* session drives the root; background sessions' tool calls execute against that root. Documented; out of scope to multiplex.

## Testing strategy

### Server (vitest)
- `workspaces.store.test.ts`: 6 cases — create, list, rename, delete (NULL cascade on sessions), unique-rootPath, get-missing.
- `filesystem-browser.service.test.ts`: 4 cases — happy listing, files filtered, alphabetical sort, missing-path throws.
- `workspaces.routes.test.ts`: 9 cases — GET list, POST create (happy + bad path + duplicate), PATCH rename, DELETE, GET browse (happy + invalid + default-home), POST activate-for-session.
- `history.store.test.ts` extension: 3 cases — `createEmpty({ workspaceId })` writes FK; `setSessionWorkspace` updates; reads include `workspaceId`.
- `sessions.routes.test.ts` extension: 1 case — PATCH accepts `{ workspaceId }`, rejects unknown id with 400.
- `migrate.test.ts`: bump to `[1..9]`.

### Frontend (vitest + RTL + MSW)
- `workspaces.api.test.ts`: 5 cases (one per method).
- `workspaces.store.test.ts`: 4 cases (init, create, dedupe, error).
- `WorkspacesSection.test.tsx`: 3 cases — renders list, click "+ Add" opens modal, delete row triggers confirm + remove.
- `WorkspaceBrowserModal.test.tsx`: 5 cases — null when closed, renders browse entries, click folder descends, breadcrumb click navigates, "Add this folder" calls create + closes.
- `WorkspaceChip.test.tsx`: 3 cases — shows active session's workspace (or "no workspace"), dropdown lists all, selecting one calls setSessionWorkspace + activateForSession.
- `sessions.store.test.ts` extension: 2 cases — `setActive` calls `activateForSession`; `setSessionWorkspace` PATCHes + activates.

### Integration
- `src/integration/workspaces.integration.test.tsx`: open modal via sidebar → navigate → add workspace → assign to active session via chip → MSW captures `activate-for-session`.

### Playwright
- One smoke in `e2e/smoke.spec.ts`: open Workspaces section, click "+ Add", verify the browser modal opens with breadcrumb + entries listed.

## Out of scope

- Multiplexing the Filesystem MCP across sessions (one process at a time).
- Native OS file dialogs (the server-side browser is the substitute).
- Workspace-scoped tool policies / breakpoints (slice 22 is global).
- Per-workspace skills / system instructions (slice 4 profiles cover that orthogonally).
- Watching a workspace's `rootPath` for deletion / rename on disk.
- Default-workspace setting (which one becomes active in a brand-new install).
- Bulk import of workspaces (JSON).

## Acceptance criteria

1. A new "Workspaces" section in the sidebar lists all workspaces and supports add / rename / delete.
2. "Add workspace…" opens a server-backed file-browser modal that lets the user navigate the host filesystem and pick a folder. A name field is auto-filled from the folder basename.
3. Each session can be assigned a workspace via a TopBar chip dropdown. The active session's `workspace_id` persists in SQLite.
4. Switching the focused session (or switching its workspace) triggers `setFsRoot` + `reconnectBuiltin('filesystem')` on the server when the filesystem MCP is enabled.
5. New sessions inherit the active session's workspace at creation.
6. Existing sessions with `workspace_id = NULL` continue to work; the filesystem MCP stays at `process.cwd()` for them.
7. Deleting a workspace clears `workspace_id` on any session that had it (no cascade-delete of sessions).
8. Importing a session whose `workspace_id` doesn't exist locally sets it to NULL — round-trip through slice 16 export/import works.
