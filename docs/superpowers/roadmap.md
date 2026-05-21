# Aether Roadmap

Forward-looking slice plan. Each entry is a stub — when we pick one up, the full design + plan + execution flow happens via the superpowers brainstorming / writing-plans / subagent-driven-development skills.

## Shipped

| # | Slice | Branch | Status |
|---|---|---|---|
| 0 | Foundation (toolchain, primitives, dialog system, server lib) | `feat/slice-0-foundation` | ✅ on `main` |
| 1 | Context CRUD + persistence JSON + App.tsx demolition | `feat/slice-1-context-crud` | ✅ |
| 2a | Real streaming chat (single session) | `feat/slice-2a-chat-streaming` | ✅ |
| 2b | Multi-session chat | `feat/slice-2b-multi-session` | ✅ |
| 3 | Reasoning steps | `feat/slice-3-reasoning` | ✅ |
| 4 | Profiles + import/export | `feat/slice-4-profiles` | ✅ |
| 5 | Command palette + shortcuts | `feat/slice-5-cmdk` | ✅ |
| 6 | Sub-agent dispatch | `feat/slice-6-subagent` | ✅ |
| 7 | MCP mock conforme | `feat/slice-7-mcp` | ✅ |
| 8 | Ollama provider + multi-provider runtime | `feat/slice-8-ollama` | ✅ |
| 9 | Sub-agent skills/tools editor | `feat/slice-9-subagent-editor` | ✅ |
| 10 | MCP advanced (HTTP+SSE, auto-reconnect, refresh, progress, cancel) | `feat/slice-10-mcp-advanced` | ✅ |
| 11 | Anthropic provider via Claude Agent SDK (OAuth + API key) | `feat/slice-11-anthropic` | ✅ |
| 12 | OpenAI provider via Chat Completions API | `feat/slice-12-openai` | ✅ |
| 13 | SQLite persistence (fully relational, 16 tables) | `feat/slice-13-sqlite` | ✅ |

## Planned

### Slice 14 — Cancellation UX polish

**Branch:** `feat/slice-14-cancel-ux`

**Scope:** the Stop button on `MessageInput` already aborts the streaming dispatch, but the resulting message has no visible "stopped" indicator beyond the existing `interrupted: true` field. This slice surfaces it in the UI: a small "(stopped)" badge on the partial assistant message, optionally with the partial token count, and a "Resume from here" affordance that creates a new turn continuing from the partial reply.

**Likely touch:** `ChatMessage` component, `useStreamingDispatch` hook (no backend changes — `interrupted` is already persisted).

**Estimate:** 1 small slice. No new dependency, no schema change.

---

### Slice 15 — Full-text search over messages (SQLite FTS5)

**Branch:** `feat/slice-15-fts-search`

**Scope:** add a SQLite FTS5 virtual table mirroring `messages.content`, with INSERT/UPDATE/DELETE triggers to keep it in sync. New endpoint `GET /api/search?q=...` returns matching sessions + snippet excerpts. A Cmd+F / Cmd+K integration in the Command Palette lets users search across all chat history.

**Likely touch:** new migration (002_fts.sql), new `SearchService` in `server/domain/search/`, route + tests, FE Command Palette integration.

**Estimate:** 1 medium slice. SQLite already in place from slice 13. No new dependency.

---

### Slice 16 — Export/import single session

**Branch:** `feat/slice-16-session-io`

**Scope:** "Export this session" menu item on each session row → downloads a JSON file containing the full `SessionRecord` (messages + reasoning + tool_call_traces). "Import session" button on the sidebar reads a JSON file and creates a new session from it (new UUID; preserves messages but resets timestamps to now). The schema for the export format is versioned (`version: 1` field) so future format changes can be migrated.

**Likely touch:** `HistoryStore.exportSession(id)` + `importSession(data)` methods, route handlers `GET /api/sessions/:id/export` + `POST /api/sessions/import`, FE Sidebar menu items, zod schema for the import payload.

**Estimate:** 1 medium slice. No new dependency.

---

### Slice 17 — Provider auth status pane

**Branch:** `feat/slice-17-provider-auth-pane`

**Scope:** a small popover or sidebar section that shows the current auth status of every provider — Anthropic (OAuth via `claude` CLI / API key / unavailable), OpenAI (API key set/unset), Gemini (API key set/unset), Ollama (daemon reachable/unreachable). Currently the user can only see this in the server log. Includes a "Refresh auth status" button that re-runs the probes without restarting the server.

**Likely touch:** new endpoint `GET /api/providers/auth-status`, server-side probe orchestration (lift `detectAnthropicAuth` + add similar probes for the others), new FE component, new store field.

**Estimate:** 1 medium slice. No new dependency. Requires factoring auth-status probes into a shared module on the backend.

---

## Notes

- Slice numbering is reserved sequentially — if you pick slice 15 before 14, the branch name still matches the table entry.
- Each slice should ship in its own PR with the standard spec → plan → execute flow.
- This roadmap is a living document; reorder / drop / add entries freely when context shifts.
