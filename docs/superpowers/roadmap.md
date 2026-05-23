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

### Slice 18 — In-app provider key vault

**Branch:** `feat/slice-18-key-vault`

**Scope:** lets the user enter / update / clear provider API keys (Gemini, OpenAI, Anthropic) from a modal opened via a palette command, without restarting the server. Keys persist to SQLite encrypted with a machine-local key derived from `os.hostname()` + `os.userInfo().username`. After save: `ProviderRegistry.refresh()` + `AuthStatusService.probe()` re-run so the registry and auth pane update live. Env-var keys remain the override; the vault is read only when no env var is set.

**Likely touch:** new migration for `provider_keys` table, `KeyVaultService` (set/get/clear + envelope crypto), `GET/PUT/DELETE /api/providers/keys`, FE `KeyVaultModal` opened from palette, integration with the existing `ProviderRegistry.refresh()` path.

**Estimate:** 1 medium slice. No new dependency (uses Node `crypto`).

---

### Slice 19 — Conversation forking + cost meter (bundled)

**Branch:** `feat/slice-19-fork-and-meter`

**Scope:** two complementary additions.

- **Fork:** hover any user message → "Branch from here" copies the session up to that message into a brand-new session (new UUIDs, fresh timestamps — reuses the existing `importSession` rewrite logic), switches active, and drops everything after. Right-click on a session row → "Duplicate" forks at the latest message.
- **Cost meter:** add `tokens_in`, `tokens_out`, `cost_usd` columns to `messages` (migration). Each provider's `done` event already carries usage (or use the slice-14 token estimator as fallback). Surface running session total in the `TopBar` next to the provider chip and per-session in the sidebar row tooltip. Per-message tooltip on the message bubble shows in/out tokens.

**Likely touch:** new `HistoryStore.forkSession(sessionId, fromMessageId)`, route `POST /api/sessions/:id/fork`, FE row button, migration `003_message_usage.sql`, provider adapters expose usage, token aggregation selector in the chat store, `TopBar` cost chip.

**Estimate:** 1 medium slice (small + small).

---

### Slice 20 — Message attachments (images + text files)

**Branch:** `feat/slice-20-attachments`

**Scope:** drag-and-drop or paste attachments into the chat input. Backend accepts multipart upload, stores attachments as DB rows (`messages_attachments` table with mime, name, size, content), and adapts to each provider's multimodal format (Anthropic image blocks, OpenAI Chat Completions vision parts, Gemini image parts; Ollama: skipped with a "provider does not support attachments" note). Render thumbnails / file chips in `MessageBubble`. Hard cap per dispatch: 5 attachments, 10 MB total.

**Likely touch:** `004_attachments.sql` migration, multipart dispatch route variant or new sub-route, attachment storage helper, provider adapter changes (anthropic / openai / gemini), `MessageInput` drag/paste handling + attachment chip row, `MessageBubble` attachment rendering, MSW handlers, integration tests, Playwright.

**Estimate:** 1 large slice. No new dependency beyond Node's built-in multipart parsing or a tiny library (`busboy`) if needed.

---

## Notes

- Slice numbering is reserved sequentially — if you pick slice 15 before 14, the branch name still matches the table entry.
- Each slice should ship in its own PR with the standard spec → plan → execute flow.
- This roadmap is a living document; reorder / drop / add entries freely when context shifts.
