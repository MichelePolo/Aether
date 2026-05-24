# Aether Slice 22 — Agentic Breakpoints + Dry-Run Sandboxing (design spec)

**Date:** 2026-05-24
**Branch:** `feat/slice-22-breakpoints`
**Roadmap entry:** docs/superpowers/roadmap.md → "Slice 22 — Agentic Breakpoints + Dry-Run Sandboxing"

## Goal

Generalize the existing per-tool `autoApprove` flag (slice 7) into a per-category breakpoints policy with three categories — `safe`, `dangerous`, `external` — controlled globally and overridable per tool. Add a rich `<ApprovalGate>` modal that shows the tool's category, args, and a diff preview for filesystem writes, plus a session-scoped "auto-approve this tool" sticky checkbox.

## Scope decisions

| Decision | Choice |
|---|---|
| Category vocabulary | `safe` / `dangerous` / `external` |
| Classification | Heuristic on tool name + args; explicit per-tool override; `external` is override-only |
| Default policy | `safe = auto`, `dangerous = gate`, `external = gate` |
| Per-tool `autoApprove` (slice 7) | Kept as override; wins when set |
| Approval UI | Dedicated `<ApprovalGate>` modal with category badge, args, **diff preview for filesystem writes**, sticky checkbox |
| Sticky scope | Per tool name, session-scoped (clears on session switch / new session) |
| Policy edit surface | Dedicated sidebar `<BreakpointsSection>` (3 toggle rows) |
| Per-tool override edit surface | Extend `McpToolCard` toggle to a 4-state `<select>`: Auto-approve / Safe / Dangerous / External |

## Data shapes

```sql
-- server/db/migrations/007_breakpoint_policy.sql
CREATE TABLE breakpoint_policy (
  category TEXT PRIMARY KEY CHECK (category IN ('safe','dangerous','external')),
  mode TEXT NOT NULL CHECK (mode IN ('auto','gate'))
);
INSERT INTO breakpoint_policy (category, mode) VALUES ('safe', 'auto');
INSERT INTO breakpoint_policy (category, mode) VALUES ('dangerous', 'gate');
INSERT INTO breakpoint_policy (category, mode) VALUES ('external', 'gate');
```

```ts
// server/domain/mcp/breakpoints/breakpoints.types.ts
export type ToolCategory = 'safe' | 'dangerous' | 'external';
export type CategoryMode = 'auto' | 'gate';

export interface BreakpointPolicy {
  safe: CategoryMode;
  dangerous: CategoryMode;
  external: CategoryMode;
}

export interface ClassifiedTool {
  qualifiedName: string;
  category: ToolCategory;
  source: 'heuristic' | 'override';
}

export const DANGEROUS_NAME_PATTERNS: RegExp[] = [
  /^[^.]+\.(write|edit|delete|move|create|remove|rename|drop|truncate)_/i,
  /^[^.]+\.execute_command$/i,
  /^[^.]+\.git_(rebase|push|reset)/i,
];

export const DANGEROUS_SHELL_PATTERNS: RegExp[] = [
  /git\s+push\s+(-f|--force)/,
  /npm\s+publish/,
  /yarn\s+publish/,
  /pnpm\s+publish/,
  /git\s+reset\s+--hard/,
  /git\s+rebase/,
  />\s*\/dev\/sd[a-z]/,
];
```

```ts
// server/domain/context/context.types.ts (extension)
export interface McpToolPolicy {
  autoApprove?: boolean;
  category?: ToolCategory;
}
```

Both fields optional. Existing rows with just `{ autoApprove: boolean }` continue to work.

### Routes

```
GET    /api/breakpoints/policy
PUT    /api/breakpoints/policy/:category   body { mode: 'auto'|'gate' }
POST   /api/breakpoints/preview            body { qualifiedName, args }
GET    /api/breakpoints/classify?qualifiedName=...&argsJson=...
```

```ts
// preview response
type PreviewResult =
  | { kind: 'diff'; oldText: string; newText: string; path: string }
  | { kind: 'plain' };
```

The existing `PATCH /api/mcp/:id/tools/:name` route (slice 7) accepts the extended `McpToolPolicy` body (zod schema updated).

## Architecture

### Server

- **Migration 007** — `breakpoint_policy` singleton-style table (3 rows, one per category).
- **`server/domain/mcp/breakpoints/breakpoints.types.ts`** — types + pattern arrays.
- **`server/domain/mcp/breakpoints/classify.ts`** — pure `classifyTool({ qualifiedName, args, override? }): ClassifiedTool`. Resolution: explicit `override.category` → name regex match (`dangerous`) → `safe` fallback. Heuristic never assigns `external`. For tools matching the shell-exec name (`execute_command`), the args' `cmd` is ALSO scanned against `DANGEROUS_SHELL_PATTERNS` (purely informational — confirms `dangerous` already assigned by name; doesn't downgrade).
- **`server/domain/mcp/breakpoints/policy.store.ts`** — `BreakpointPolicyStore.read(): BreakpointPolicy`; `setCategory(category, mode): void`.
- **`server/domain/mcp/breakpoints/breakpoints.service.ts`** — `BreakpointService.resolveDecision({ qualifiedName, args }): 'auto' | 'gate'`:
  1. `policy = mcpRegistry.policy(qualifiedName)` returns `{ autoApprove?, category? }`.
  2. If `policy.autoApprove === true` → `'auto'`.
  3. If `policy.autoApprove === false` → `'gate'`.
  4. `category = policy.category ?? classifyTool({ qualifiedName, args }).category`.
  5. `mode = policyStore.read()[category]`. Return `'auto'` if `mode === 'auto'`, else `'gate'`.
- **`server/domain/mcp/breakpoints/preview.service.ts`** — `previewToolCall({ qualifiedName, args }): Promise<PreviewResult>`. Logic in §2. Path safety: file must resolve under one of the safe roots — `process.cwd()`, the filesystem MCP's configured root (slice 21), or any active workspace root (slice 23, future). Files > 1 MB → `'plain'`.
- **`server/domain/dispatch/dispatch.service.ts`** — replace the existing line `const policy = ...mcpRegistry?.policy(...); const decision = policy.autoApprove ? 'approve' : await ...awaitDecision(...)` with:
  ```ts
  const mode = await this.deps.breakpointService.resolveDecision({
    qualifiedName: pendingCall.qualifiedName,
    args: pendingCall.args,
  });
  const decision: 'approve' | 'reject' = mode === 'auto'
    ? 'approve'
    : await (this.deps.mcpRegistry?.awaitDecision(pendingCall.callId, 60_000) ?? Promise.resolve('reject' as const)).catch(() => 'reject' as const);
  ```
  `DispatchServiceDeps` gains `breakpointService: BreakpointService`.
- **`server/routes/breakpoints.routes.ts`** — the 4 new routes.
- **`server/routes/mcp.routes.ts`** — the existing per-tool policy `PATCH` accepts `{ autoApprove?, category? }`.
- **`server/app.ts`** — `policyStore?` + `breakpointService?` + `previewService?` in `AppDeps`; mount `/api/breakpoints`.
- **`server/index.ts`** — construct the new services, wire into `DispatchService` and `createApp`.

### Frontend

- **`src/types/breakpoints.types.ts`** — mirror of server types.
- **`src/lib/api/breakpoints.api.ts`** — `getPolicy`, `setCategoryMode`, `preview`, `classify`.
- **`src/stores/breakpoints.store.ts`** — Zustand store. State: `policy: BreakpointPolicy`, `loading`, `error`. Actions: `init()`, `setCategoryMode(c, mode)`. Per-category dedupe via module-level `Map<string, Promise>` (same pattern as `providerAuth.store`).
- **`src/stores/chat.store.ts`** — adds `stickyApprovals: Set<string>` plus `addStickyApproval(qualifiedName)` / `clearStickyApprovals()`. `reset()` clears them (so session switch and new-session both reset).
- **`src/stores/ui.store.ts`** — `approvalGateState: { event, preview } | null`, `openApprovalGate(state)`, `closeApprovalGate()`.
- **`src/hooks/useToolCallDecisions.ts`** — replace the existing `confirm()`-based dialog flow:
  1. On `tool_call_request` event: if `chat.stickyApprovals.has(event.qualifiedName)` → immediately call `mcpApi.decide(id, 'approve')` and return.
  2. Else: `await breakpointsApi.preview(...)` → `useUiStore.openApprovalGate({ event, preview })`.
  3. Modal owns the decision flow + close.
- **`src/components/chat/ApprovalGate.tsx`** — modal:
  - Category badge: red for `dangerous`, orange for `external`. Category resolved via `breakpointsApi.classify` on mount (or read from the event if the server attached it — keep server-driven via separate fetch for now).
  - Tool name + pretty JSON args.
  - If `preview.kind === 'diff'`: `<DiffView oldText newText path>`.
  - Approve / Reject buttons.
  - Checkbox "Auto-approve this tool for the rest of this session".
  - Escape / outside-click → Reject.
- **`src/components/chat/DiffView.tsx`** — small unified-diff renderer (~80 LOC): splits both texts on `\n`, walks lines, emits a sequence of `{ kind: 'same'|'add'|'remove', text }` items. No external dep. Monospace rendering with green `+` / red `-` line prefixes; no inter-line LCS — simple parallel walk with a one-line lookahead is fine for v1 (long file diffs may not align perfectly, but that's acceptable scope).
- **`src/components/sidebar/BreakpointsSection.tsx`** — 3-row section: each row has Auto / Gate toggle for one category.
- **`src/components/sidebar/McpToolCard.tsx`** — replace the toggle with a 4-state `<select>`:
  - "Auto-approve" → `{ autoApprove: true }`.
  - "Safe" → `{ category: 'safe' }`.
  - "Dangerous" → `{ category: 'dangerous' }`.
  - "External" → `{ category: 'external' }`.
  - Placeholder text shows the heuristic-inferred category when no override exists.
- **`src/App.tsx`** — mount `<BreakpointsSection />` below `<BuiltinMcpToggles />`; mount `<ApprovalGate />` near other modals; call `useBreakpointsStore.getState().init()` on App mount.

### MSW
- `src/test/msw-handlers.ts` — defaults for the 4 new endpoints.

## Data flow

### Server-side resolution per tool call
1. Dispatcher receives `function_call` chunk from provider.
2. Emits `tool_call_request` SSE.
3. `breakpointService.resolveDecision(...)` → `'auto'` or `'gate'`.
4. If `'auto'`: execute via existing path.
5. If `'gate'`: `awaitDecision(callId, 60_000)` — same as today.

### FE on `tool_call_request`
1. Sticky check: if in `stickyApprovals`, `mcpApi.decide(id, 'approve')`. Done.
2. Else: `breakpointsApi.preview(...)` (returns plain or diff).
3. `openApprovalGate({ event, preview })`.
4. Modal renders. User decides.
5. Approve: optional `chat.addStickyApproval(qualifiedName)`; `mcpApi.decide(id, 'approve')`; close.
6. Reject: `mcpApi.decide(id, 'reject')`; close.

### Policy change (sidebar)
1. `breakpointsStore.setCategoryMode('dangerous', 'auto')` PUTs.
2. Server writes the row, returns full updated policy. Store replaces local.
3. Next dispatch picks up via `policyStore.read()` (no caching beyond per-call).

### Per-tool override change
1. User changes `<select>` on a `<McpToolCard>` tool row.
2. FE: `mcpApi.setToolPolicy(serverId, toolName, payload)` (existing route).
3. Server persists in `context_mcp_servers.toolPolicies`.
4. `mcpRegistry.policy(...)` next call returns the updated row.

### Sticky lifecycle
- Set in the modal on Approve+checkbox. Stored in `useChatStore.stickyApprovals` (FE-only).
- Cleared by `useChatStore.reset()` — which is already called on `setActive` and new-session creation.

## Error handling

| Scenario | Server | FE |
|---|---|---|
| Preview path outside safe roots | `{ kind: 'plain' }` | Modal shows args only |
| Preview file > 1 MB | `{ kind: 'plain' }` | Same |
| Preview read failure (permissions, vanished) | `{ kind: 'plain' }` | Same |
| `setCategoryMode` invalid mode | 400 VALIDATION_ERROR | Banner via `breakpointsStore.error` |
| `setCategoryMode` invalid category in URL | 400 | Same |
| Per-tool policy invalid `category` | 400 (zod) | `<select>` reverts |
| Server `awaitDecision` 60 s timeout | Emits `tool_call_result` with `error: 'Rejected by user'` | Modal still open; on next decision the FE sees the server-rejected result and forces-close |
| Multiple pending calls (provider emits in series) | One at a time — same as today | Modal queues; opens next after current closes |

**Sticky security note:** sticky approvals are FE-only and session-scoped. They never persist to disk. The server still validates every call, but trusts the FE to gate. Acceptable for a single-user local dev tool.

## Testing strategy

### Server (vitest)
- `classify.test.ts`: 6 cases — name patterns, `execute_command`, read-only safe, overrides (3 variants).
- `policy.store.test.ts`: 3 cases — read seeded, setCategory, persistence.
- `breakpoints.service.test.ts`: 6 cases covering all resolution branches.
- `preview.service.test.ts`: 7 cases — happy diff, missing path, edit_file, oversized file, non-write tool, missing args, outside-root rejection.
- `breakpoints.routes.test.ts`: 7 cases — GET/PUT policy + preview + classify + 400 paths.
- `dispatch.service.test.ts`: extend with 2 cases (auto-resolution executes; gate-resolution awaits decision).
- `mcp.routes.test.ts`: extend with 1 case (per-tool PATCH accepts `category`).
- `migrate.test.ts`: bump to `[1..7]`.

### Frontend (vitest + RTL + MSW)
- `breakpoints.api.test.ts`: 4 cases (one per method).
- `breakpoints.store.test.ts`: 4 cases (init, set, dedupe, error).
- `chat.store.test.ts` extend: 3 sticky cases.
- `DiffView.test.tsx`: 4 cases — same text, removed, added, mixed.
- `ApprovalGate.test.tsx`: 6 cases — null state, category badge, diff render, approve, reject, sticky checkbox.
- `useToolCallDecisions.test.tsx` rewrite: 2 cases — sticky hit, gate flow.
- `BreakpointsSection.test.tsx`: 3 cases — renders 3 rows, toggle dispatches, default modes shown.
- `McpToolCard.test.tsx` extend: 3 cases — 4-state select, change to category, change to autoApprove.

### Integration
- `src/integration/approval-gate.integration.test.tsx`: dispatch triggers tool_call_request → ApprovalGate opens with category + args → Approve → MSW captures `decide('approve')` → modal closes.

### Playwright
- One smoke: `<BreakpointsSection>` shows 3 rows; toggle `dangerous` mode without crashes.

## Out of scope

- Per-tool sticky with arg-pattern matching (just per-tool name in v1).
- Server-persisted sticky (FE-only is fine for a single-user local dev tool).
- Diff for non-filesystem operations (commit diff, DB schema diff, etc.).
- Inline-diff word-level highlighting (line-level only).
- A "review queue" of pending dangerous calls when user is away (modal-and-respond is enough for an interactive dev session).
- The `external` category being auto-detected (override-only this slice).

## Acceptance criteria

1. A new "Breakpoints" section in the sidebar shows three rows (`safe`, `dangerous`, `external`) each with Auto / Gate toggles, defaulting to `safe=auto`, `dangerous=gate`, `external=gate`.
2. A new dispatcher pre-flight step calls `BreakpointService.resolveDecision` before every tool call; the result drives whether the existing `awaitDecision` is invoked.
3. When a `dangerous` tool call requires approval, an `<ApprovalGate>` modal opens showing the category badge, the tool's args, and (for write-file-like tools) a unified diff of old vs new content.
4. The modal exposes an "Auto-approve this tool for the rest of this session" checkbox; checking it + Approve adds the tool to `useChatStore.stickyApprovals`, which is consulted on subsequent `tool_call_request` events and cleared on session switch.
5. Each per-tool row on `<McpToolCard>` becomes a 4-state `<select>` (Auto-approve / Safe / Dangerous / External). Changing it persists via the existing per-tool PATCH route.
6. Existing per-tool `autoApprove` rows continue to work unchanged (backwards compatible).
7. Round-trip through slice 16 export/import is unaffected (breakpoint policy is server-singleton, not session-scoped).
