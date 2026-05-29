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

## Candidate Killer Features (hypothetical — eligible, not yet sequenced)

These are **not committed** and carry no fixed slice number yet. They're parked here
to capture intent; each gets the full spec → plan → execute flow if/when picked up.
Numbers are placeholders (`Sxx`) — assign sequentially at pickup time.

### Git integration

**Scope:** a curated git layer inside the studio — **not** a raw terminal. Wrap the git
CLI (reuse the slice 21 terminal MCP) or a library; expose discrete, gated actions.
Discipline assumed: **trunk-based / GitHub Flow** (short-lived branches → PR → squash),
matching how this repo is already governed.

Tiers:
- **Tier 1 (read-only, MVP):** `status`, `diff` / `diff --staged` (feeds the existing
  `DiffView`), `log`, current branch + branch list. Unlocks a real "Changes" pane and
  working-tree-vs-HEAD compare.
- **Tier 2 (write):** `add` (selective staging), `commit` (message draftable by the
  agent from the diff), `switch`/`checkout -b` (e.g. per-session branches), `restore`
  (discard — destructive, gated).
- **Tier 3 (remote):** `push` / `pull` / `fetch`, fast-forward `merge` with conflict
  surfacing.
- **Deferred (high risk):** interactive `rebase`, `cherry-pick`, conflict resolution,
  `reset --hard`, history rewrite → escalate to the human.

**Safety:** every write/destructive command routes through a breakpoint gate (slice 22)
with a diff preview before execution — same pattern as MCP tool calls.

**Builds on:** Slice 21 (terminal MCP), Slice 22 (breakpoints); reuses `DiffView`.

### Codebase-aware RAG (vector + AST)

**Status note:** referenced earlier as *deliberately excluded* from the agentic-depth
track — it was never implemented. Captured here as a candidate. This is a **multi-slice
arc**, not a single slice.

**Scope:** index the workspace into a retrievable representation: chunk + embed source
into a vector store, and parse files into **ASTs** (e.g. tree-sitter) for structure-aware
retrieval (symbols, definitions, call graphs) rather than pure text similarity. Feed
relevant context into dispatch automatically. Likely needs: an indexer/watcher, an
embedding provider abstraction, a vector store (sqlite-vss or similar), an AST parser
layer, and a retrieval step wired into `prompt-assembler`.

**Builds on:** Slice 13 (SQLite), Slice 23 (workspaces), dispatch context assembly.

### Other eligible candidates (one-liners)

- **Cost & usage analytics + budgets** — aggregate the per-message token usage already
  captured into per-session/provider dashboards, with configurable spend caps.
- **Scheduled / background agents** — cron-driven autonomous runs on top of the slice 24
  daemon (e.g. nightly swarm, watch-and-react jobs).
- **Sub-agent / swarm eval harness** — golden-input regression tests for prompts and
  swarms, so prompt edits can be scored before shipping.

---

## Notes

- Slice numbering is reserved sequentially — if you pick slice 15 before 14, the branch name still matches the table entry.
- Each slice should ship in its own PR with the standard spec → plan → execute flow.
- This roadmap is a living document; reorder / drop / add entries freely when context shifts.
