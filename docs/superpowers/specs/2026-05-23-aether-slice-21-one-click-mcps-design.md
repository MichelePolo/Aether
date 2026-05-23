# Aether Slice 21 — 1-click coding MCPs (Filesystem + Terminal) (design spec)

**Date:** 2026-05-23
**Branch:** `feat/slice-21-one-click-mcps`
**Roadmap entry:** docs/superpowers/roadmap.md → "Slice 21 — 1-click coding MCPs"

## Goal

Let the user enable a pre-configured Filesystem MCP server and a pre-configured Terminal MCP server with a single toggle each, without hand-writing JSON config. The filesystem uses the official Anthropic `@modelcontextprotocol/server-filesystem` package; the terminal is a small custom MCP server in this repo (`aether-shell`) with timeout, output cap, and a blocklist of dangerous commands.

## Scope decisions

| Decision | Choice |
|---|---|
| Filesystem implementation | Spawn `@modelcontextprotocol/server-filesystem` via stdio. New npm dep. |
| Terminal implementation | Custom in-repo `aether-shell.ts` MCP server spawned via stdio. |
| Shell safety | 30 s default timeout (max 120 s), 1 MB stdout+stderr cap, blocklist of dangerous patterns. |
| UI placement | New `<BuiltinMcpToggles>` section above `<McpServersSection>`. Built-ins never appear in the manual MCP list. |
| Persistence | Separate `builtin_mcp_state` table (2 rows). `context_mcp_servers` untouched. |
| Filesystem root default | `process.cwd()` at server boot; persisted `fs_root` override allowed. |

## Data shapes

```sql
-- server/db/migrations/006_builtin_mcp_state.sql
CREATE TABLE builtin_mcp_state (
  transport TEXT PRIMARY KEY CHECK (transport IN ('filesystem','terminal')),
  enabled INTEGER NOT NULL DEFAULT 0,
  fs_root TEXT
);

INSERT INTO builtin_mcp_state (transport, enabled, fs_root) VALUES ('filesystem', 0, NULL);
INSERT INTO builtin_mcp_state (transport, enabled, fs_root) VALUES ('terminal', 0, NULL);
```

```ts
// server/domain/mcp/builtin/builtin.types.ts
export type BuiltinTransport = 'filesystem' | 'terminal';

export interface BuiltinMcpState {
  transport: BuiltinTransport;
  enabled: boolean;
  fsRoot: string | null;   // null = use server boot's process.cwd()
}

export interface BuiltinMcpListResponse {
  builtins: BuiltinMcpState[];
}

export const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\/(?!\w)/,
  /\bsudo\b/,
  /:\(\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;\s*:/,
  /\bdd\s+if=/,
  /\bmkfs\./,
  /\s>\s*\/dev\/sd[a-z]/,
  /\bchmod\s+-R\s+777\s+\//,
];

export const SHELL_DEFAULTS = {
  timeoutMs: 30_000,
  maxTimeoutMs: 120_000,
  outputCapBytes: 1 * 1024 * 1024,
};
```

### Routes

```
GET  /api/mcp/builtin            → { builtins: BuiltinMcpState[] }
PUT  /api/mcp/builtin/:transport → body { enabled?: boolean; fsRoot?: string | null }
                                   → { state: BuiltinMcpState }
```

`PUT` semantics:
- Write DB first, then call `mcpRegistry.startBuiltin` / `stopBuiltin` / `reconnectBuiltin` as appropriate.
- `fsRoot` change while enabled triggers `reconnectBuiltin`.
- Invalid `fsRoot` (non-existent or not a directory) → 400.

### `aether-shell` tool surface

```ts
{
  name: 'execute_command',
  description: 'Run a shell command in the workspace. 30s default timeout, 1 MB output cap, dangerous patterns blocked.',
  inputSchema: {
    type: 'object',
    properties: {
      cmd: { type: 'string' },
      cwd: { type: 'string' },
      timeout: { type: 'number' },
    },
    required: ['cmd'],
  },
}
```

Output content:
```
<stdout-truncated>
---
<stderr-truncated>
---
exit code: <n>          // or: timeout after <ms>ms / blocked by safety policy: <pattern>
```

`isError: true` when: blocklist match (no spawn) / exit ≠ 0 / timeout fired.

## Architecture

### Server

- **Migration 005** is from slice 20; this slice adds **006**.
- **`server/domain/mcp/builtin/builtin.types.ts`** — types + `BLOCKED_PATTERNS` + `SHELL_DEFAULTS`.
- **`server/domain/mcp/builtin/builtin.store.ts`** — `BuiltinMcpStore`:
  - `read(): BuiltinMcpState[]` — returns both rows.
  - `setEnabled(t, enabled)`.
  - `setFsRoot(t, root)`.
  - `toConfigs(defaultCwd: string): McpServerConfig[]` — synthesizes in-memory `McpServerConfig` for each *enabled* row. Filesystem: `{ id: 'builtin:filesystem', transport: 'stdio', command: process.execPath, args: [resolveFilesystemServerEntry(), fsRoot ?? defaultCwd] }`. Terminal: `{ id: 'builtin:terminal', transport: 'stdio', command: process.execPath, args: [resolveAetherShellEntry()] }`.
- **`server/mcp/builtin/aether-shell.ts`** (standalone Node script) — manually implements the MCP stdio protocol: reads JSON-RPC frames from stdin, writes responses to stdout. Three handled methods: `initialize`, `tools/list`, `tools/call`. The `execute_command` handler is exported and unit-tested separately (without stdio framing).
- **`server/mcp/builtin/aether-shell.handler.ts`** — pure function `executeCommand({ cmd, cwd?, timeout? }): Promise<{ isError: boolean; content: [{ type: 'text'; text: string }] }>`. Owns the blocklist check, spawn, buffer + cap, timeout race, and result formatting.
- **`server/domain/mcp/registry.ts`** — extend `McpRegistryDeps` with `builtinStore?: BuiltinMcpStore`. `init()` merges `builtinStore.toConfigs(cwd)` into the connect list. New methods:
  - `startBuiltin(t: BuiltinTransport): Promise<void>` — materialize config, connect.
  - `stopBuiltin(t: BuiltinTransport): Promise<void>` — disconnect.
  - `reconnectBuiltin(t: BuiltinTransport): Promise<void>` — stop then start.
  - `list()` filters out any entry whose id starts with `'builtin:'`.
- **`server/routes/builtin-mcp.routes.ts`** — `GET /` + `PUT /:transport`. Validates `fsRoot` via `fs.statSync`.
- **`server/app.ts`** — add `builtinStore?: BuiltinMcpStore` to `AppDeps`; mount `app.use('/api/mcp/builtin', createBuiltinMcpRoutes(builtinStore, mcpRegistry))`.
- **`server/index.ts`** — construct `new BuiltinMcpStore(db)` post-migration, pass to `mcpRegistry` and `createApp`.

### Frontend

- **`src/types/mcp.types.ts`** — add `BuiltinTransport`, `BuiltinMcpState`.
- **`src/lib/api/builtin-mcp.api.ts`** — `listBuiltins()`, `setBuiltin(t, patch)`.
- **`src/stores/builtinMcp.store.ts`** — Zustand store mirroring the existing pattern from `providerAuth.store` / `keyVault.store`:
  - State: `builtins: BuiltinMcpState[]`, `loading: boolean`, `error: string | null`.
  - Actions: `init()`, `toggle(t)`, `setFsRoot(t, root)`.
  - Per-transport dedupe via a module-level `Map<string, Promise>`.
  - After successful mutation, calls `useMcpStore.refresh()` so the tools list and live state propagate.
- **`src/components/sidebar/BuiltinMcpToggles.tsx`** — new section. Two rows; each:
  - Status dot (subscribed to `useMcpStore` for `builtin:<transport>` state).
  - Label ("Filesystem" or "Terminal").
  - Filesystem row also shows the current `fsRoot` (truncated middle if long, with full path in `title`).
  - Toggle button (disabled while a per-transport mutation is in flight).
- **`src/components/sidebar/McpServersSection.tsx`** — filter out servers with id starting `'builtin:'`.
- **`src/App.tsx`** — mount `<BuiltinMcpToggles />` above `<McpServersSection />`. Call `useBuiltinMcpStore.getState().init()` alongside other inits.
- **`src/test/msw-handlers.ts`** — defaults for `GET /api/mcp/builtin` (both disabled) and `PUT /api/mcp/builtin/:transport`.

## Data flow

### Bootstrap
1. Migrations apply. `BuiltinMcpStore` constructed.
2. `mcpRegistry.init()` reads both `context_mcp_servers` (user) and `builtinStore.toConfigs(process.cwd())` (enabled built-ins). Connects them.

### Toggle ON
1. FE: `useBuiltinMcpStore.toggle('filesystem')` → optimistic flip + PUT.
2. Server route: `BuiltinMcpStore.setEnabled('filesystem', true)` → `mcpRegistry.startBuiltin('filesystem')` → respond with the post-connect state.
3. FE on success: replace local row with server state; fire `useMcpStore.refresh()` to pull tools.

### Toggle OFF
1. PUT `{ enabled: false }`.
2. Server: `mcpRegistry.stopBuiltin(t)` (SIGTERM, force-kill after 1 s) → `BuiltinMcpStore.setEnabled(t, false)` → respond.
3. FE updates.

### `fsRoot` change
1. PUT `{ fsRoot: '/new/path' }`.
2. Server validates path. If invalid → 400.
3. `BuiltinMcpStore.setFsRoot(...)`.
4. If filesystem enabled → `mcpRegistry.reconnectBuiltin('filesystem')`. Else skip.

### Tool call routing
- No changes to the dispatch layer. `mcpRegistry.getAvailableTools()` already returns tools from all connected MCP servers including built-ins. Tools follow the standard auto-approval / decision pipeline.

## Error handling

| Scenario | Server | FE |
|---|---|---|
| Invalid `fsRoot` | 400 VALIDATION_ERROR | Banner via `chat.store.error` |
| Missing `@modelcontextprotocol/server-filesystem` dep | 500 `BUILTIN_FILESYSTEM_UNAVAILABLE` (registry surfaces); row stays enabled but offline | Row shows red dot + tooltip with the error |
| Missing `aether-shell.js` artifact (production) | 500 `BUILTIN_TERMINAL_UNAVAILABLE` | Same |
| Blocklisted command | `tools/call` → `isError: true` `"blocked by safety policy: <pattern>"` | Standard MCP tool error rendering |
| Timeout fired | `tools/call` → `isError: true` `"timeout after Xms"` | Same |
| Output cap exceeded | Output truncated + `[output truncated]` appended; `isError` follows exit code | Same |

**Concurrency:** Per-transport dedupe map in `useBuiltinMcpStore`. Server route handlers naturally serialize per-process; no extra locking needed.

**Shutdown:** existing `McpRegistry.shutdown()` already aborts all stdio subprocesses on SIGTERM. Built-ins use the same code path.

## Testing strategy

### Server (vitest)
- **`builtin.store.test.ts`**: read seeded rows, setEnabled, setFsRoot, `toConfigs` returns only enabled (5 cases).
- **`aether-shell.handler.test.ts`**: happy path (echo), non-zero exit, blocked patterns (4–5 patterns), timeout, output cap, custom cwd (7 cases).
- **`registry.test.ts` additions**: `init()` connects built-ins; `startBuiltin`/`stopBuiltin`/`reconnectBuiltin`; `list()` filters built-ins out (4 cases).
- **`builtin-mcp.routes.test.ts`**: 7 cases (GET, PUT enable→starts, PUT disable→stops, PUT fsRoot reconnects, invalid fsRoot 400, null fsRoot reverts, invalid transport 400).
- **`migrate.test.ts`**: bump assertion to `[1,2,3,4,5,6]`.

### Frontend (vitest + RTL + MSW)
- **`builtin-mcp.api.test.ts`**: 3 cases (list, toggle, setFsRoot).
- **`builtinMcp.store.test.ts`**: 5 cases (init, toggle, dedupe, setFsRoot, network failure).
- **`BuiltinMcpToggles.test.tsx`**: 4 cases (renders 2 rows, toggle dispatches, fsRoot shown, status dot reflects useMcpStore).
- **`McpServersSection.test.tsx` additions**: filters `'builtin:*'` rows.

### Integration (vitest + RTL + MSW)
- **`src/integration/builtin-mcp.integration.test.tsx`**: App mounts → MSW returns 2 disabled rows → user clicks Filesystem toggle → PUT captured → row flips.

### Playwright (`e2e/smoke.spec.ts`)
- One smoke: page loads → assert both toggle rows visible → click Filesystem on → wait for connected state → click off. No real subprocess required (MSW would handle in test env; real e2e runs against the actual server, which spawns the real filesystem MCP — the smoke just verifies the UI round-trips).

## Out of scope

- Per-tool autoApprove on built-in tools (uses the regular MCP policy mechanism; user can still toggle per-tool in the MCP server card — but built-ins don't appear in `McpServersSection` so this isn't surfaced; slice 22 will add a unified breakpoints UI).
- Editing the filesystem `fsRoot` from the UI (read-only display this slice; slice 23's Workspaces UI replaces it).
- Multiple workspace roots for the filesystem MCP (slice 23).
- Terminal command history / replay.
- Streaming long-running command output.

## Acceptance criteria

1. A new "Coding Tools" section appears in the sidebar above MCP Servers, with two toggle rows: Filesystem and Terminal.
2. Toggling Filesystem ON spawns `@modelcontextprotocol/server-filesystem` rooted at `process.cwd()` (or the configured `fs_root`); its tools become available to the model.
3. Toggling Terminal ON spawns `aether-shell` via stdio; its `execute_command` tool becomes available to the model.
4. Toggles persist across server restarts via the `builtin_mcp_state` table.
5. Blocklisted commands run via Terminal return `isError: true` with a "blocked by safety policy" message; no subprocess is spawned.
6. Commands that exceed the 30 s default timeout (or the per-call `timeout` argument, capped at 120 s) are terminated; result is `isError: true` with a timeout message.
7. Built-in MCPs do NOT appear in the user-facing `McpServersSection` list.
8. Slice 16 export/import is unaffected (built-in state is server-local, not session-scoped).
