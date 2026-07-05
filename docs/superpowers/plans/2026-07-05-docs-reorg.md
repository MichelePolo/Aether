# Documentation Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the public Aether repo's documentation into a navigable learning path (README → docs index → getting-started → architecture → guides → reference), with English canonical + Italian translations under `docs/it/`, historical artifacts archived, and unreferenced images removed.

**Architecture:** Docs-only change on branch `docs/documentation-reorg`. English is the source of truth; `docs/it/` holds derivative translations of the human-path docs with a banner. Every technical claim in a new doc is verified against the source file it cites.

**Tech Stack:** Markdown, git. Spec: `docs/superpowers/specs/2026-07-05-docs-reorg-design.md`.

## Global Constraints

- Branch: `docs/documentation-reorg`; `main` is protected — everything lands via one PR (squash).
- **Content sourcing rule:** every behavioral claim must be verified by reading the cited source file at authoring time; cite paths in backticks (e.g. `server/domain/dispatch/dispatch.service.ts`). No aspirational content.
- Every new doc starts with a 1–2 sentence "What this covers / when to read it" line.
- English canonical; Italian files carry this banner as their first line after the H1:
  `> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [<title>](<relative path to EN file>).`
- Use `git mv` for moves (preserve history); `git rm` for deletions.
- Relative links only, so they work on GitHub and locally.
- Commit after each task with a `docs:` conventional-commit message.
- Verification helper used by several tasks (run from repo root):
  ```bash
  # link check: fails listing any relative md link target that does not exist
  grep -RhoE '\]\((\.{0,2}/?[^)#:]+\.md)' README.md CONTRIBUTING.md docs --include='*.md' -r \
    | sed -E 's/.*\]\(//' > /tmp/links.txt || true
  ```
  (Task 12 defines the full script; earlier tasks may verify links manually with `ls`.)

---

### Task 1: Cleanup — images, stale root files, archive skeleton

**Files:**
- Delete: `docs/Gemini_Generated_Image_h6wth0h6wth0h6wt.png`, `docs/Gemini_Generated_Image_kxmyumkxmyumkxmy.png`
- Delete (untracked): `docs/Skill-Smith.png`
- Create: `docs/archive/README.md`
- Move: `UX_REVIEW.md` → `docs/archive/2026-05-24-ux-review.md`; `docs/Aether_Code_Review.md` → `docs/archive/aether-code-review.md`; `docs/Aether_Comprehensive_Audit.md` → `docs/archive/aether-comprehensive-audit.md`; `docs/Aether_Killer_Features.md` → `docs/archive/aether-killer-features.md`; `docs/e2e-test-plan.md` → `docs/archive/e2e-test-plan.md`; `docs/context_consumption.md` → `docs/archive/context-consumption.md`; `docs/swarms.md` → `docs/archive/swarms.md`

**Interfaces:**
- Produces: `docs/archive/` with a disclaimer README; a `docs/` directory containing only `archive/` and `superpowers/` (plus specs of this work), ready for the new tree.

- [ ] **Step 1: Verify the PNGs are unreferenced** (guard before deletion)

Run: `grep -RniE 'Gemini_Generated|Skill-Smith' --include='*.md' --include='*.html' --include='*.ts*' . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=docs/superpowers`
Expected: no output (references inside `docs/superpowers/plans/` to the *subagent* "skill-smith" are text, not image links — excluded).

- [ ] **Step 2: Delete images and move files**

```bash
git rm docs/Gemini_Generated_Image_h6wth0h6wth0h6wt.png docs/Gemini_Generated_Image_kxmyumkxmyumkxmy.png
rm -f docs/Skill-Smith.png
mkdir -p docs/archive
git mv UX_REVIEW.md docs/archive/2026-05-24-ux-review.md
git mv docs/Aether_Code_Review.md docs/archive/aether-code-review.md
git mv docs/Aether_Comprehensive_Audit.md docs/archive/aether-comprehensive-audit.md
git mv docs/Aether_Killer_Features.md docs/archive/aether-killer-features.md
git mv docs/e2e-test-plan.md docs/archive/e2e-test-plan.md
git mv docs/context_consumption.md docs/archive/context-consumption.md
git mv docs/swarms.md docs/archive/swarms.md
```

- [ ] **Step 3: Write `docs/archive/README.md`**

```markdown
# Archive

Point-in-time artifacts: audits, reviews, and design notes kept for historical
reference. **They are not current documentation** — file paths, findings, and
plans here may no longer match the codebase. For up-to-date docs start from
[`docs/README.md`](../README.md).
```

- [ ] **Step 4: Verify tree and commit**

Run: `ls docs docs/archive`
Expected: `docs/` contains only `archive/`, `superpowers/`; `docs/archive/` contains README + 7 moved files.

```bash
git add -A && git commit -m "docs: remove unreferenced images, archive stale audits and reviews"
```

---

### Task 2: `docs/superpowers/README.md` — declare the design history

**Files:**
- Create: `docs/superpowers/README.md`

**Interfaces:**
- Produces: directory-level framing that AI agents and humans read before the specs/plans.

- [ ] **Step 1: Write the file**

```markdown
# Development history (superpowers)

This directory is the **design history** of Aether, not its current
documentation. Work is organized in numbered *slices*; each slice has a design
spec (`specs/`) and an implementation plan (`plans/`), plus the running
[`roadmap.md`](roadmap.md).

Read these to understand *why* something was built the way it was. For *what
the system is today*, start from [`docs/README.md`](../README.md) — where a
spec and the code disagree, the code wins.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/README.md && git commit -m "docs: frame docs/superpowers as design history"
```

---

### Task 3: `docs/reference/configuration.md` + `docs/reference/api.md` + `docs/reference/database.md`

**Files:**
- Create: `docs/reference/configuration.md`, `docs/reference/api.md`, `docs/reference/database.md`
- Source to verify against: `README.md` env table (lines 90–113), `.env.example`, `server/app.ts` (route mounting), `server/lib/sse.ts` (SSE events), `server/db/migrations/` (schema), `server/db/migrate.ts`

**Interfaces:**
- Produces: the reference tier linked by README (config) and by guides. `configuration.md` becomes the single home of the env-var table (README will link to it in Task 4).

- [ ] **Step 1: Write `configuration.md`**

Opening line: "Every environment variable Aether reads, with defaults. All are optional. When to read it: you're configuring a deployment or enabling a provider."
Content: move the full env-var table from `README.md` verbatim, then verify each variable still exists with `grep -rn 'process.env.AETHER_\|process.env.GEMINI\|process.env.ANTHROPIC\|process.env.OPENAI\|process.env.OLLAMA\|process.env.CLAUDE_CODE' server/ cli/ --include='*.ts' | grep -v test`. Drop or fix any row that doesn't match. Keep the openai-compat/vLLM paragraph (headers encrypted, `/v1/models` discovery). End with a "See also" linking `../guides/providers.md` and `../guides/key-vault.md`.

- [ ] **Step 2: Write `api.md`**

Opening line: "The REST surface and the SSE event vocabulary of the dispatch stream. When to read it: you're scripting against Aether or debugging a stream."
Content: enumerate mounted route groups by reading `server/app.ts` (`createApp`), one table row per group (path prefix, purpose, backing service). Document SSE event types by reading `server/lib/sse.ts` and the chunk types in `server/domain/dispatch/providers/provider.types.ts` (`text` / `thinking` / `function_call` / `done`, plus breakpoint/approval events found in `dispatch.service.ts`). Document error shape `{ error: { code, message } }` citing `server/lib/errors.ts`. Do NOT invent request/response bodies — link the route file for each group instead.

- [ ] **Step 3: Write `database.md`**

Opening line: "How persistence works: SQLite file layout, append-only migrations, FTS, cascade rules. When to read it: you're changing schema or debugging data."
Content: single file at `${AETHER_DATA_DIR}/aether.sqlite`; migrations in `server/db/migrations/NNN_name.sql` applied in numeric order inside transactions, tracked in `_migrations` (`server/db/migrate.ts`); the hard rule **add a new migration, never edit an existing one**; FKs ON with `ON DELETE CASCADE`/`SET NULL`; list current migration files via `ls server/db/migrations/` (write the actual list at authoring time). Mention FTS table and BLOB attachments citing the migration that created each.

- [ ] **Step 4: Verify and commit**

Run: `ls server/db/migrations/` and cross-check the list in `database.md`; spot-check 3 env vars from `configuration.md` against grep output.

```bash
git add docs/reference && git commit -m "docs: add reference tier (configuration, api, database)"
```

---

### Task 4: README rewrite

**Files:**
- Modify: `README.md`
- Depends on existing: `docs/reference/configuration.md` (Task 3)

**Interfaces:**
- Produces: links `docs/README.md` (created in Task 5 — forward reference is intentional; final link check happens in Task 12), `docs/reference/configuration.md`, `docs/it/README.md` (Task 10).

- [ ] **Step 1: Rewrite `README.md`** keeping the sections listed in the spec:

Structure (content adapted from the current README, tightened):
```markdown
# Aether Core

> 🇬🇧 English · [🇮🇹 Italiano](docs/it/README.md)

[![codecov](https://codecov.io/gh/MichelePolo/Aether/branch/main/graph/badge.svg)](https://codecov.io/gh/MichelePolo/Aether)

<pitch paragraph — keep current one>
<single-process note — keep>

## Features            ← keep the 8 bullets, trim each to ≤2 lines
## Install (one-liner) ← keep verbatim (curl/PowerShell/npm tarball)
## Run locally         ← 3 steps only; link reference/configuration.md for env vars
## Documentation       ← NEW: "Start here → docs/README.md", then the ordered path:
                          getting-started → architecture → guides/ → reference/
                          + link to the minisite https://michelepolo.github.io/Aether
## Tech stack          ← keep table
## Architecture        ← keep ASCII sketch + entrypoint links
## Project layout      ← update docs/ line: "docs/  Documentation — start at docs/README.md"
```
Removals: the "Private repo" HTML comment and `?token=…` from the badge URL; the full env-var table (replaced by one line linking `docs/reference/configuration.md`); the Scripts table and CLI section (replaced by links to `docs/development.md` and `docs/guides/cli.md`).

- [ ] **Step 2: Verify and commit**

Run: `grep -c 'token=' README.md` → expected `0`; `grep -n 'docs/README.md' README.md` → at least 2 hits.

```bash
git add README.md && git commit -m "docs: rewrite README as lean showcase linking the docs path"
```

---

### Task 5: `docs/README.md` — the map

**Files:**
- Create: `docs/README.md`

**Interfaces:**
- Consumes: file names fixed by the spec tree (guides land in Tasks 7–8; forward links are intentional until Task 12's link check).
- Produces: the navigation spine every other doc links back to.

- [ ] **Step 1: Write the ordered map**

```markdown
# Aether documentation

A reading path, in order. Each step assumes the previous ones.

| # | Read | You'll learn |
|---|------|--------------|
| 1 | [Getting started](getting-started.md) | Install, first dispatch, enabling providers |
| 2 | [Architecture](architecture.md) | The single-process model, domain layer, dispatch loop |
| 3 | [Guides](#guides) | One deep-dive per domain — pick what you touch |
| 4 | [Reference](#reference) | Exact tables: env vars, API/SSE, database |
| 5 | [Development](development.md) | Tests, conventions, how changes land |

## Guides
- [Providers](guides/providers.md) — registry, key resolution, sticky selection, vLLM
- [Key vault](guides/key-vault.md) — encrypted credentials at rest
- [MCP tools](guides/mcp-tools.md) — connecting tool servers, built-ins, call caps
- [Breakpoints](guides/breakpoints.md) — approval gates on dangerous tool calls
- [Workspaces](guides/workspaces.md) — project folders and the filesystem MCP
- [History](guides/history.md) — sessions, forking, export/import, search
- [Subagents & swarms](guides/subagents-swarms.md) — cross-model delegation
- [Scheduler](guides/scheduler.md) — scheduled/background agents
- [CLI](guides/cli.md) — `aether` daemon and one-shot usage

## Reference
- [Configuration](reference/configuration.md) · [API & SSE](reference/api.md) · [Database](reference/database.md)

## Elsewhere
- [Contributing](../CONTRIBUTING.md) — how changes land (PR-only, squash)
- [Archive](archive/README.md) — historical audits (not current)
- [Design history](superpowers/README.md) — per-slice specs and plans
- 🇮🇹 [Documentazione in italiano](it/README.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/README.md && git commit -m "docs: add docs index with ordered reading path"
```

---

### Task 6: `docs/getting-started.md` + `docs/architecture.md` + `docs/development.md`

**Files:**
- Create: `docs/getting-started.md`, `docs/architecture.md`, `docs/development.md`
- Source to verify against: `README.md` (install/run), `CLAUDE.md`, `server/index.ts`, `server/app.ts`, `server/domain/dispatch/dispatch.service.ts`, `vitest.config.ts`, `package.json` scripts

**Interfaces:**
- Produces: the three core-path docs linked from `docs/README.md`.

- [ ] **Step 1: Write `getting-started.md`**

Opening line: "From zero to your first dispatch. When to read it: you've just cloned or installed Aether."
Sections: **Install** (link back to README one-liners, don't duplicate); **Explore with no keys** (`AETHER_FAKE_PROVIDER=1 npm run dev`, what the Fake provider does); **Enable a real provider** (env var *or* Provider Auth pane; link `guides/providers.md`); **Your first dispatch** (open http://localhost:3000, pick provider in TopBar, send a message; where reasoning/tokens appear); **Where things live** (`./data/aether.sqlite`, `AETHER_DATA_DIR`); **Next** → `architecture.md`.

- [ ] **Step 2: Write `architecture.md`**

Opening line: "The mental model of the whole system, for humans and AI agents. When to read it: before changing anything non-trivial."
Sections, each verified against the cited file:
1. **One process** — Express + Vite middleware in dev, prebuilt SPA in prod (`server/index.ts`).
2. **Composition root** — `bootstrap()` builds stores/services/providers and hands them to `createApp(deps)`; optional deps → routes mount only when present, which is why tests wire minimal apps (`server/app.ts`).
3. **Domain layer** — the 10 feature folders under `server/domain/`, each with store/service/types/routes pattern.
4. **Dispatch loop** — the 5 numbered steps as in CLAUDE.md (provider resolution → context/@subagent/attachments → assemble → streaming loop with SSE + breakpoint gating + tool-call cap → tracing/persistence), citing `dispatch.service.ts`.
5. **Persistence** — one paragraph, link `reference/database.md`.
6. **Frontend** — Zustand store-per-domain, stores call `src/lib/api/*.api.ts` (never fetch inline), optimistic-update-with-rollback pattern, SSE via `src/hooks/useStreamingDispatch.ts`.
Include the README's ASCII diagram (single source: keep it here full-size, README keeps the small sketch).

- [ ] **Step 3: Write `development.md`**

Opening line: "How to work on Aether: commands, test layout, conventions. When to read it: before your first PR."
Content distilled from CLAUDE.md + `vitest.config.ts` + `package.json`: commands table (dev/lint/build/test/e2e — the Scripts table removed from README lands here); the two Vitest projects (frontend jsdom / backend node), colocated tests, globals on, 80% coverage thresholds on the five path groups; focused-test recipes; `@/*` import alias; slice workflow on `feat/slice-N-*` branches; `DISABLE_HMR=true` and why the vite.config conditional must not be "fixed"; note that some comments/audits are in Italian by design. Link `../CONTRIBUTING.md` for the PR workflow.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run --project backend --reporter=dot 2>&1 | tail -2` only if unsure a cited command is real; otherwise verify each command name against `package.json` with `grep '"scripts"' -A 12 package.json`.

```bash
git add docs/getting-started.md docs/architecture.md docs/development.md
git commit -m "docs: add getting-started, architecture, development"
```

---

### Task 7: Guides batch 1 — providers, key-vault, mcp-tools, breakpoints

**Files:**
- Create: `docs/guides/providers.md`, `docs/guides/key-vault.md`, `docs/guides/mcp-tools.md`, `docs/guides/breakpoints.md`
- Source to verify against: `server/domain/providers/registry.ts`, `server/domain/providers/key-vault.ts`, `server/domain/dispatch/providers/provider.types.ts`, `server/domain/mcp/`, `server/domain/dispatch/dispatch.service.ts` (breakpoints, tool-call cap)

**Interfaces:**
- Produces: four guides linked from `docs/README.md`. Shared template for ALL guides (Tasks 7–8): H1, 1–2 sentence opener ("What this covers / when to read it"), "How it works" narrative citing source files, "Key files" list, "See also" links.

- [ ] **Step 1: Write `providers.md`**

Cover: the `AIProvider` interface and the 5+ implementations (fake, gemini, ollama, anthropic, openai, openai-compat); `ProviderRegistry.refresh()` building the `transport:model` map, inclusion only when the credential resolves (Ollama via live `/api/tags` discovery); env-first `KeyResolver` fallback to vault; sticky per-session `providerName` and the TopBar/localStorage default; `AETHER_DEFAULT_PROVIDER`; openai-compat endpoints added from the Provider Auth pane with encrypted custom headers and `/v1/models` discovery, id shape `openai-compat:<endpoint>:<model>`. Verify each claim in `registry.ts` before writing it.

- [ ] **Step 2: Write `key-vault.md`**

Cover: AES-256-GCM encryption in SQLite (`key-vault.ts`); key material — random key persisted at `${AETHER_DATA_DIR}/.vault.key` or `AETHER_VAULT_KEY` override (64 hex chars); env-first resolution order; plaintext never returned by the API; what happens on key mismatch during migration (cite the warning behavior from `key-vault.ts` — see PR #114).

- [ ] **Step 3: Write `mcp-tools.md`**

Cover: connecting any MCP server; 1-click built-ins (filesystem, terminal) toggleable from the UI; how tool declarations join the system assembly at dispatch; the per-dispatch call cap (default 25, `AETHER_MAX_TOOL_CALLS`); where servers are registered (`server/domain/mcp/`).

- [ ] **Step 4: Write `breakpoints.md`**

Cover: `BreakpointService` gating each tool call → `auto` (run) vs `gate` (await user approve/reject, 24h timeout); the diff/preview approval UI; CLI behavior (gated calls auto-rejected — interactive approval is web-UI only); how gating interacts with the dispatch SSE stream. Verify the 24h timeout constant in the source before stating it.

- [ ] **Step 5: Verify citations and commit**

Run: `for f in registry.ts key-vault.ts; do ls server/domain/providers/$f; done && ls server/domain/mcp/`
Expected: all cited paths exist.

```bash
git add docs/guides && git commit -m "docs: add guides for providers, key vault, MCP tools, breakpoints"
```

---

### Task 8: Guides batch 2 — workspaces, history, subagents-swarms, scheduler, cli

**Files:**
- Create: `docs/guides/workspaces.md`, `docs/guides/history.md`, `docs/guides/subagents-swarms.md`, `docs/guides/scheduler.md`, `docs/guides/cli.md`
- Delete (after salvage): `SCHEDULER TEST GUIDE.md`
- Source to verify against: `server/domain/workspaces/`, `server/domain/history/`, `server/domain/subagents/`, `SCHEDULER TEST GUIDE.md`, `cli/`, current README CLI section

**Interfaces:**
- Consumes: guide template from Task 7.
- Produces: remaining five guides; root freed of `SCHEDULER TEST GUIDE.md`.

- [ ] **Step 1: Write `workspaces.md`**

Cover: adding/browsing project folders via GUI; Aether managing the underlying filesystem MCP; workspace-delete cascade behavior (verify in `server/domain/workspaces/`).

- [ ] **Step 2: Write `history.md`**

Cover: persisted sessions; forking (time-travel from any message); JSON export/import of conversation trees; FTS search; token/usage meter; attachments as BLOBs (images + text docs, 10 MB dispatch cap, text inlined as fenced blocks, images only to vision-capable providers — verify in `dispatch.service.ts` attachment preprocessing).

- [ ] **Step 3: Write `subagents-swarms.md`**

Cover: leading `@subagent` mention resolution at dispatch; subagents targeting different providers than the parent; the seeded `skill-smith` subagent; swarms (multi-step, per-step LLM — distill from `server/domain/subagents/` and the archived `docs/archive/swarms.md`, citing only what the code confirms).

- [ ] **Step 4: Write `scheduler.md`**, salvaging `SCHEDULER TEST GUIDE.md`

Translate to EN and restructure: **How it works** (poller inside the single Node process, 30 s tick + boot catch-up, 1 min minimum interval → up to ~90 s first-run latency, `AETHER_SCHEDULER=0` to disable, API under `/api/schedules`); **Trying it out** (the useful parts of the manual test guide: Fake-provider smoke, ▶ Run now button, results persisted to history). Then:

```bash
git rm "SCHEDULER TEST GUIDE.md"
```

- [ ] **Step 5: Write `cli.md`**

Move the README CLI section here and expand: daemon lifecycle (`start/status/stop`, binds 127.0.0.1, runs `dist/server.cjs` so `npm run build` is a prerequisite), one-shot + `--session`, stdin piping, `--json` JSONL events, stdout/stderr split, shared SQLite with the web UI, gated calls auto-rejected. Verify flags against `cli/` source.

- [ ] **Step 6: Verify and commit**

Run: `ls "SCHEDULER TEST GUIDE.md" 2>&1` → expected "No such file"; `ls docs/guides | wc -l` → expected `9`.

```bash
git add -A && git commit -m "docs: add remaining guides; fold scheduler test guide into docs"
```

---

### Task 9: `CONTRIBUTING.md` in English

**Files:**
- Modify: `CONTRIBUTING.md` (full rewrite in EN, same rules)

**Interfaces:**
- Produces: EN contributing guide linked from `docs/README.md` and `docs/development.md`.

- [ ] **Step 1: Translate/rewrite**

Preserve every rule of the current Italian file exactly (GitHub Flow, protected `main`, PR-only, @MichelePolo approval, squash merge, linear history, branch prefixes, the step-by-step flow with the same commands). Add one closing line linking `docs/development.md` for test/conventions. Do not add new rules.

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md && git commit -m "docs: translate CONTRIBUTING to English"
```

---

### Task 10: Italian translations — `docs/it/`

**Files:**
- Create: `docs/it/README.md`, `docs/it/getting-started.md`, `docs/it/guides/providers.md`, `docs/it/guides/key-vault.md`, `docs/it/guides/mcp-tools.md`, `docs/it/guides/breakpoints.md`, `docs/it/guides/workspaces.md`, `docs/it/guides/history.md`, `docs/it/guides/subagents-swarms.md`, `docs/it/guides/scheduler.md`, `docs/it/guides/cli.md`

**Interfaces:**
- Consumes: the EN docs from Tasks 5–8 (translate them, don't re-derive from code).
- Produces: the Italian human path. NOT translated (by spec): architecture, development, reference, CONTRIBUTING — `docs/it/README.md` links their EN versions with a note "(in inglese)".

- [ ] **Step 1: Write `docs/it/README.md`** — faithful translation of `docs/README.md`, same table/order; rows for untranslated docs point at `../<file>` with "(in inglese)". First line after H1: `> 🇮🇹 Questa è la documentazione italiana. 🇬🇧 [English (canonica)](../README.md).`

- [ ] **Step 2: Translate getting-started and the 9 guides**

Each file: same structure as the EN original, banner line (Global Constraints) pointing to its EN counterpart via relative path (e.g. `../../guides/providers.md` from `docs/it/guides/providers.md`). Keep code blocks, commands, file paths, and identifiers untranslated.

- [ ] **Step 3: Verify and commit**

Run: `ls docs/it docs/it/guides | wc -l` → 11 files total; `grep -L 'Traduzione derivata' docs/it/getting-started.md docs/it/guides/*.md` → no output (all have the banner; the index has its own variant).

```bash
git add docs/it && git commit -m "docs: add Italian translations of the human-path docs"
```

---

### Task 11: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: CLAUDE.md consistent with the new tree so agents navigate correctly.

- [ ] **Step 1: Edit the docs-related lines**

In the "Working conventions" section, after the roadmap bullet, add:

```markdown
- Current documentation lives in `docs/` (start at `docs/README.md`; EN canonical, IT translations under `docs/it/`); `docs/archive/` and `docs/superpowers/` are historical — don't cite them as current behavior.
```

Also update the final bullet ("Some code comments and the `docs/` audits are written in Italian…") to say the audits now live in `docs/archive/`.

- [ ] **Step 2: Run lint and commit**

Run: `npm run lint`
Expected: exit 0 (no TS touched, sanity check).

```bash
git add CLAUDE.md && git commit -m "docs: point CLAUDE.md at the new documentation tree"
```

---

### Task 12: Link check + final review + PR

**Files:**
- No new files (fix-ups only, in place)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run the link check**

```bash
fail=0
while IFS=: read -r file link; do
  target=$(python3 -c "import os,sys; print(os.path.normpath(os.path.join(os.path.dirname('$file'), '$link')))")
  [ -f "$target" ] || { echo "BROKEN: $file -> $link"; fail=1; }
done < <(grep -RhoE '' /dev/null; grep -RnoE '\]\([^)#:*[:space:]]+\.md' README.md CONTRIBUTING.md CLAUDE.md docs -r --include='*.md' | sed -E 's/([0-9]+):.*\]\(/:/' )
exit $fail
```
(If the one-liner proves brittle, verify with a manual pass: open every `.md` link in `README.md`, `docs/README.md`, `docs/it/README.md` and `ls` the target.)
Expected: no `BROKEN:` lines.

- [ ] **Step 2: Final sweep**

Run: `git ls-files '*.png' '*.jpg' | xargs -r du -h` → expected: no multi-MB files; `grep -rn 'token=' README.md` → 0 hits; `ls` root → no `SCHEDULER TEST GUIDE.md`, no `UX_REVIEW.md`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin docs/documentation-reorg
gh pr create --base main --title "docs: reorganize documentation for the public repo" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-07-05-docs-reorg-design.md:

- Lean README → docs/README.md reading path (getting-started → architecture → guides → reference → development)
- EN canonical + Italian translations under docs/it/ (human-path docs only, with derivation banners)
- Historical audits moved to docs/archive/; docs/superpowers framed as design history
- Removed 10 MB of unreferenced images; Codecov badge token dropped; CONTRIBUTING translated to EN; CLAUDE.md updated

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
