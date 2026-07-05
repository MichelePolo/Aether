# Workspaces

What this covers: how a project folder becomes an Aether workspace, how the filesystem browser and built-in MCP servers root themselves to it, and what happens to related data when a workspace is deleted. Read this when you're adding/browsing workspaces or debugging built-in MCP re-rooting.

## How it works

A workspace is just a name plus a `rootPath` on disk, stored by `WorkspacesStore` (`server/domain/workspaces/workspaces.store.ts`). `POST /api/workspaces` (`server/routes/workspaces.routes.ts`) validates that `rootPath` exists and is a directory (via `fs.statSync`) before inserting; a duplicate `rootPath` is rejected with a `ValidationError` (SQLite `UNIQUE` constraint on the column). `GET /api/workspaces/browse?path=` lists only the subdirectories of a given path (`FilesystemBrowserService.browse()`, `server/domain/workspaces/filesystem-browser.service.ts`), defaulting to the OS home directory when no `path` is supplied — this is what powers the "browse for a folder" picker in the UI.

Once a session or schedule is associated with a workspace (`workspaceId`), `DispatchService` re-roots the built-in filesystem/terminal/git MCP servers to that workspace's path at dispatch time (`ensureRootedBuiltins`, see [MCP tools](mcp-tools.md)) — so the model's filesystem/shell/git tools operate against the correct project folder as the active workspace changes.

**Delete cascade**: `WorkspacesStore.delete()` runs in a transaction that first nulls out `workspace_id` on any `schedules`, `swarms`, and `swarm_steps` rows referencing the workspace (checking each table exists first, since not every deployment has all of them), then deletes the workspace row itself. Deleting a workspace does **not** delete the schedules/swarms that pointed at it — they're detached and fall back to the builtin filesystem root / `process.cwd()` (the scheduler explicitly guards against this for schedules — see [Scheduler](scheduler.md)).

## Key files

- `server/domain/workspaces/workspaces.store.ts` — `WorkspacesStore`: CRUD + the delete cascade
- `server/domain/workspaces/filesystem-browser.service.ts` — `FilesystemBrowserService.browse`
- `server/domain/workspaces/workspaces.types.ts` — `Workspace`, `BrowseEntry`
- `server/routes/workspaces.routes.ts` — `POST /`, `GET /browse`, `PATCH /:id`, `DELETE /:id`

## See also

- [MCP tools](mcp-tools.md) — how built-in servers are re-rooted to the active workspace
- [Scheduler](scheduler.md) — schedules can target a workspace and skip runs if it's gone
- [Architecture](../architecture.md) — where workspaces fit in the dispatch flow
