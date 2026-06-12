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
| 26 | Test-Driven Auto-Resolution (configurable command, fixer sub-agent, SSE loop) | `feat/slice-26-tdd-loop` | ✅ |
| 27 | Git Swimlanes (read-only history viz: deterministic per-branch colors, first-parent swimlanes, inferred PRs, on-demand diff; dedicated git domain + History view) | `feat/slice-27-git-swimlanes` | ✅ |
| 28 | Git write actions (Tier 2): agent-initiated add/commit/checkout/restore via a builtin `aether-git` MCP, gated through the slice-22 breakpoint machinery with an in-process git diff preview | `feat/slice-28-git-write` | ✅ |
| 29 | Git remote actions (Tier 3): agent-initiated fetch/push/pull(ff-only)/merge(ff-only) on the `aether-git` MCP; ambient host auth (GIT_TERMINAL_PROMPT=0), configured-remote-only targets, commitList gate preview | `feat/slice-29-git-remote` | ✅ |

## Planned

The **agentic-depth Killer Features track (slices 24–26) is fully shipped**, and **all three
tiers of Git integration are shipped**: Tier 1 (slice 27, read-only Git Swimlanes), Tier 2
(slice 28, write actions), and Tier 3 (slice 29, remote actions). What remains of Git
integration is only the high-risk **Deferred** bucket (interactive rebase, cherry-pick,
conflict resolution, reset --hard, history rewrite → escalate to human). Other candidates
live in the section below.

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
- **Tier 1 (read-only, MVP):** ✅ **shipped as slice 27 (Git Swimlanes).** `status`, `log`
  (`--all` → deterministic swimlanes), per-commit per-file `diff` (`git show`, on-demand).
  Delivered as a dedicated `server/domain/git/` (allowlisted, no-shell runner) + a dedicated
  **History view**. Note: the working-tree-vs-HEAD "Changes" pane (`diff`/`diff --staged`)
  was **not** part of slice 27 — slice 27 visualizes committed history; the uncommitted-
  changes pane is a follow-up.
- **Tier 2 (write):** ✅ **shipped as slice 28 (Git write actions).** `add` (selective
  staging), `commit` (message draftable by the agent), `checkout`/`checkout -b`, `restore`
  (discard). Delivered as **agent-initiated** tools on a builtin `aether-git` MCP server
  (not UI buttons): each write is a real MCP tool call, so it flows through the existing
  slice-22 breakpoint gate (classified dangerous → gate) with an in-process git diff
  preview before execution. The git cwd auto-roots to the active session's workspace.
- **Tier 3 (remote):** ✅ **shipped as slice 29 (Git remote actions).** `fetch`, `push`,
  `pull --ff-only`, `merge --ff-only` — agent-initiated tools on the `aether-git` MCP.
  `push`/`pull`/`merge` gate (dangerous) with a **commitList** preview (outgoing/incoming
  commits); `fetch` is safe→auto. Auth is **ambient** (host git credentials, `GIT_TERMINAL_
  PROMPT=0` fail-fast; Aether stores none); targets are **configured-remote names only**
  (charset + `git remote` membership → no URLs, no filesystem paths). `--ff-only` aborts
  cleanly on divergence → escalate to human; never `--force`.
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
