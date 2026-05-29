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
| 14 | Cancellation UX polish (Riprendi + token estimate) | `feat/slice-14-cancel-ux` | ✅ |
| 15 | Full-text search over messages (SQLite FTS5) | `feat/slice-15-fts-search` | ✅ |
| 16 | Export/import single session (JSON envelope) | `feat/slice-16-session-io` | ✅ |
| 17 | Provider auth status pane | `feat/slice-17-provider-auth-pane` | ✅ |
| 18 | In-app provider key vault (AES-256-GCM) | `feat/slice-18-key-vault` | ✅ |
| 19 | Conversation forking + token-only context meter | `feat/slice-19-fork-and-meter` | ✅ |
| 20 | Message attachments (images + text files) | `feat/slice-20-attachments` | ✅ |
| 21 | 1-click coding MCPs (Filesystem + Terminal) | `feat/slice-21-one-click-mcps` | ✅ |
| 22 | Agentic breakpoints + dry-run sandboxing | `feat/slice-22-breakpoints` | ✅ |
| 23 | Native workspace management GUI | `feat/slice-23-workspaces` | ✅ |
| 24-ux | UX/a11y fixes (dialog, tooltip, focus-visible, ApprovalGate hardening, i18n) | `feat/slice-24-ux-fixes` | ✅ |
| 24 | Headless Daemon + `aether-cli` (detached server, PID/endpoint file, SSE-streaming CLI, Unix piping) | `feat/slice-24-headless-cli` | ✅ |
| 24.1 | Runnable production server bundle (esbuild import.meta.url + migrations in dist, smoke CI) | `feat/slice-24.1-prod-bundle` | ✅ |
| 25 | Multi-Agent Swarms (linear DSL, per-step approval, SSE run) | `feat/slice-25-swarms` | ✅ |

## Planned

## Killer Features — agentic depth track

Sequence chosen to build foundation (safety + zero-friction onboarding) before going wide with multi-agent orchestration. **RAG (codebase-aware vector + AST) deliberately excluded from this track** — it's a multi-slice arc that deserves its own future roadmap section.

### Slice 26 — Test-Driven Auto-Resolution (Red-Green-Refactor Loop)

**Branch:** `feat/slice-26-tdd-loop`

**Scope:** bidirectional integration with Vitest (Playwright as a follow-up). User defines tests + interfaces; Aether enters an autonomous loop: edit code → run `npx vitest run <path>` via the terminal MCP (slice 21) → parse stack trace + failed assertions → feed the parsed diagnostics back into the agent context → retry up to N times (default 5). Stops on green, or when the `dangerous` breakpoint policy (slice 22) requires approval, or after max retries. Surfaced as a palette command `Auto-fix tests…`.

**Likely touch:** new `server/domain/tdd/{runner,parser}.ts` (vitest JSON reporter parser), retry loop in `DispatchService` or a dedicated `TddRunner` service, FE palette command + a streaming progress panel showing the loop state.

**Estimate:** 1 large slice.

**Builds on:** Slice 21 (terminal MCP), Slice 22 (breakpoints).

---

## Notes

- Slice numbering is reserved sequentially — if you pick slice 15 before 14, the branch name still matches the table entry.
- Each slice should ship in its own PR with the standard spec → plan → execute flow.
- This roadmap is a living document; reorder / drop / add entries freely when context shifts.
