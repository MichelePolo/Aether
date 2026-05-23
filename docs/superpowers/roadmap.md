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

## Planned

## Killer Features — agentic depth track

Sequence chosen to build foundation (safety + zero-friction onboarding) before going wide with multi-agent orchestration. **RAG (codebase-aware vector + AST) deliberately excluded from this track** — it's a multi-slice arc that deserves its own future roadmap section.

### Slice 21 — 1-click coding MCPs (Filesystem + Terminal)

**Branch:** `feat/slice-21-one-click-mcps`

**Scope:** a "Coding Tools" mini-section in the sidebar with two toggles — `Filesystem` and `Terminal` — that each launch a pre-configured, sandboxed MCP server with no JSON-config step. Filesystem MCP is rooted at the workspace (defaults to `cwd` until Slice 23 introduces real workspaces). Terminal MCP exposes a constrained shell. Each toggle handles connect/disconnect via the existing `mcpRegistry` flow.

**Likely touch:** new `server/domain/mcp/builtin/{filesystem,terminal}.ts` (in-process or stdio adapter — TBD by brainstorming); FE preset definitions; new `<BuiltinMcpToggles>` component above `McpServersSection`; tests; Playwright smoke.

**Estimate:** 1 medium slice. May introduce one MCP-server dependency.

**Builds on:** Slice 7 (MCP) + 10 (HTTP transport + refresh + cancel).

---

### Slice 22 — Agentic Breakpoints + Dry-Run Sandboxing

**Branch:** `feat/slice-22-breakpoints`

**Scope:** generalize the existing per-tool `autoApprove` flag (slice 7) into a per-category breakpoints policy. Categories include `dangerous` (irreversible filesystem writes / git rebase / DB drops), `external` (production API calls), and `safe` (everything else; default auto-approve). Before any `dangerous` tool call, the dispatch loop pauses and surfaces a diff/plan + `Y/N` approval gate in a new `<ApprovalGate>` modal. Approval decisions can be made per-call or sticky-per-session.

**Likely touch:** `ContextStore` schema for breakpoint policies; `mcpRegistry.callTool` honors the new category; new SSE event `tool_call_approval_required`; FE `<ApprovalGate>` modal + `useChatStore` pending-approval state; useToolCallDecisions extension; tests.

**Estimate:** 1 medium slice. **Pairs naturally with Slice 21** if you want one bundle.

**Builds on:** Slice 7 (MCP tool loop) + slice 9 (sub-agents — they inherit the same policy).

---

### Slice 23 — Native Workspace Management GUI

**Branch:** `feat/slice-23-workspaces`

**Scope:** a Workspaces sidebar pane with classic "Add Project / Open Folder" dialogs (server-side dialog via Electron-style native picker, OR a manual path-input fallback in the web). Each workspace = `{ id, name, rootPath, addedAt }` row. The Filesystem MCP from Slice 21 is parameterized by the active workspace's `rootPath`. Switching the active workspace re-targets the MCP server. SQLite-backed.

**Likely touch:** migration `006_workspaces.sql`, `WorkspacesStore`, routes (`GET/POST/DELETE /api/workspaces`, `POST /api/workspaces/:id/activate`), FE `useWorkspacesStore` + `<WorkspacesSection>`, integration with slice 21's filesystem MCP.

**Estimate:** 1 medium slice. Depends on Slice 21.

---

### Slice 24 — Headless Daemon + `aether-cli`

**Branch:** `feat/slice-24-headless-cli`

**Scope:** package the existing Express server as a daemonizable background process (`aether daemon start/stop/status`), and ship a thin CLI (`aether-cli`) that streams to/from it via the existing HTTP+SSE endpoints. Supports Unix piping: `cat error.log | aether "explain this"`. Sessions created by the CLI are visible in the web UI (SQLite-backed). Output formatting: plain markdown by default, `--json` for machine-readable.

**Likely touch:** new package directory `cli/`, daemon process management (PID file in `dataDir`), CLI entrypoint with `commander`-like arg parsing, plain-text SSE consumer, npm bin entries.

**Estimate:** 1 medium slice. Independent from Slice 21–23.

---

### Slice 25 — Multi-Agent Swarms (Workflow DSL)

**Branch:** `feat/slice-25-swarms`

**Scope:** a YAML DSL that declares a sequence of sub-agent invocations with named inputs/outputs. Example: `architect` → `coder` → `qa`, where each step's `output.text` becomes the next step's prompt. The orchestrator runs the steps in order, emits reasoning steps for each transition, and pauses for human approval after the final step (Human-in-the-loop). Reuses slice 6+9 sub-agents as primitives. Pairs with slice 22 breakpoints for safe execution.

**Likely touch:** new `server/domain/swarms/{parser,orchestrator}.ts`, YAML schema (zod), new route `POST /api/swarms/run`, FE `<SwarmEditModal>` (extends sub-agent editor pattern), reasoning steps for swarm transitions.

**Estimate:** 1 medium-to-large slice.

---

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
