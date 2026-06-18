# ETERE.md — `init` skill + project-memory ingestion — Design

Date: 2026-06-18
Status: Approved (design)

## Goal

Give Aether an equivalent of Anthropic's `/init`: a way to analyze the active
workspace and produce a project-memory file named **`ETERE.md`** at the workspace
root, which Aether then **auto-loads into the system instruction of every
subsequent dispatch** (the way Claude Code consumes `CLAUDE.md`).

The feature has two independent halves:

1. **Generation** — a seeded default skill `init` (pure prompt content) that
   guides the agent to explore the repo and write/update `ETERE.md`.
2. **Ingestion** — `DispatchService` reads the active session's `ETERE.md` and
   `assemble()` injects it into the system instruction.

No new domain, no new UI, no new HTTP route.

## Context & constraints

- **Skills are directories with a `SKILL.md`** under the data dir's skills folder;
  bundled defaults live in `server/skills/defaults/<slug>/SKILL.md` and are seeded
  idempotently on boot (`server/domain/skills/seed.ts`, `skills.paths.ts`). The
  build copies `server/skills/defaults` → `dist/skills/defaults`.
- **The filesystem MCP exposes a single root** (`fs_root` in `builtin_mcp_state`,
  default `process.cwd()` — `server/domain/mcp/builtin/builtin.store.ts:87`). It is
  the only directory the agent can write to via the filesystem MCP.
- **Sessions are bound to a workspace.** `SessionMeta.workspaceId`
  (`server/domain/history/history.types.ts:39`) → `workspace.rootPath`. The
  `POST /api/workspaces/activate` route re-points the filesystem/git MCP `fs_root`
  to the active session's workspace `rootPath` and reconnects
  (`server/routes/workspaces.routes.ts:75-100`).
- **`assemble()` is pure and synchronous** (`server/domain/dispatch/prompt-assembler.ts`).
  It must stay that way: all I/O and root-resolution policy live in
  `DispatchService` / the composition root; `assemble()` only receives strings.
- **The base system prompt is provider-agnostic** — it must never reference
  "Claude"/"Anthropic" or vendor products (`2026-06-17-aether-system-prompt-design.md`).
  ETERE.md and the `init` skill follow the same rule.

### Multi-workspace model

Aether manages N workspaces, but at any instant the filesystem MCP is rooted at
**one** workspace — the active session's. Therefore:

> **One `ETERE.md` per workspace, at each workspace's `rootPath`.** N workspaces →
> N files, exactly like one `CLAUDE.md` per repo. No central registry, no
> per-workspace naming. The agent writes into, and ingestion reads from, the
> active session's workspace root — the same directory — so write and read agree.

## Design decisions

- **Trigger:** a seeded default skill `init` (chosen over UI button / MCP tool /
  chat slash-command). Reuses the existing skills domain; zero runtime code for the
  generation half.
- **Ingestion anchor:** the dispatch's **session → workspace → `rootPath`**, NOT
  the global mutable `fs_root`. The dispatch knows which session it serves, so it
  reads the correct project's memory regardless of whether `activate` last synced
  `fs_root`. This removes a cross-workspace race by construction.
- **Runtime facts always injected:** a minimal `Current time (UTC)` + `Active
  model (transport:model)` line is injected into every assembled prompt, so the
  `init` skill can copy accurate values into ETERE.md instead of hallucinating
  them. Also forward-useful for the system prompt's "Currency" behavior.
- **Size cap:** ETERE.md is injected into every dispatch and competes for tokens
  with the task; cap at **32 KB**, truncating with an explicit notice line.
- **Excluded (YAGNI):** no central index of ETERE.md files across workspaces; no
  per-workspace UI; no automatic regeneration; no slash-command parser.

## Architecture

### Half 1 — the `init` skill

New bundled default: `server/skills/defaults/init/SKILL.md`.

Frontmatter (trigger-shaped description, matching existing defaults' style):

```yaml
---
name: init
description: Analyze the current workspace and write/update ETERE.md, Aether's project-memory file at the project root. Use when the user asks to initialize the project, generate ETERE.md, or document the codebase for future agents.
---
```

Body (concise, ~30-40 lines, in the voice of the existing default skills) guides
the agent to:

1. **Explore before writing** — read-only sweep of structure, manifest
   (`package.json`/equivalent), README, build/test/lint/run commands,
   architecture, conventions, and non-obvious gotchas.
2. **Write `ETERE.md` at the project root** via the filesystem MCP. The root is
   the filesystem MCP root (= the active workspace's `rootPath`).
3. **Write the metadata header** (below), copying the **current time** and
   **active model** verbatim from the runtime-facts line in the prompt — never
   inventing them.
4. **Document for a future agent, not a human onboarding doc** — what the project
   is, the canonical commands, the architecture in brief, the conventions, and the
   traps. Do **not** restate what is obvious from the code.
5. **Regeneration is an update, not an overwrite** — if `ETERE.md` already exists:
   preserve the original `Creato` date and the existing version history, bump the
   version (`v2`, `v3`, …), and **append** a row to the version-history table with
   the new date and model.
6. **Provider-agnostic** — describe ETERE.md as "Aether's project memory"; never
   reference a vendor or product name.

#### ETERE.md metadata header (canonical layout)

```markdown
# ETERE.md — <project name>

> Aether project memory — generated automatically.
>
> - **Progetto:** <name, inferred from manifest/folder>
> - **Creato:** 2026-06-18T14:30:00Z
> - **Modello generatore:** anthropic:claude-opus-4-8
>
> #### Storico versioni
> | Versione | Data | Modello |
> |---|---|---|
> | v1 | 2026-06-18T14:30:00Z | anthropic:claude-opus-4-8 |

<documentary content: what / commands / architecture / conventions / gotchas>
```

- **Project name:** inferred by the agent from the manifest (`package.json` name)
  or the directory name.
- **Creato / version dates / models:** ground-truth values taken from the
  runtime-facts line; `Modello generatore` mirrors the latest version row's model.

### Half 2 — ingestion

#### New pure module: `server/domain/dispatch/project-memory.ts`

```ts
export const ETERE_FILENAME = 'ETERE.md';
export const PROJECT_MEMORY_CAP_BYTES = 32 * 1024;

/** Read <root>/ETERE.md, capped + truncation-noted. null if no root / absent / empty. */
export function readProjectMemory(root: string | null): string | null;
```

- Returns `null` when `root` is `null`, the file is absent, or it is empty/whitespace.
- When the file exceeds the cap, returns the first `PROJECT_MEMORY_CAP_BYTES`
  followed by a clear truncation notice line.
- Pure filesystem read; no root-resolution policy here (kept unit-testable).

#### Composition root wires root resolution

`DispatchServiceDeps` gains one optional dep:

```ts
projectRootFor?: (workspaceId: string | undefined) => string | null;
```

In `server/index.ts`, this resolves with priority:
`workspace.rootPath` (via the workspace store) → filesystem MCP `fs_root` (via the
builtin store) → `null`. All "where things live" knowledge stays in the
composition root, matching Aether's architecture.

#### `assemble()` gains runtime facts + project memory

`assemble()` takes two new optional string params (kept pure — receives strings,
never reads disk):

- `runtimeFacts?: string` — a 2-line block (`Current time (UTC): …`,
  `Active model: <transport:model>`).
- `projectMemory?: string` — the (capped) ETERE.md content.

Injection order in the system instruction:

```
<base system instruction>
[<sub-agent block> — when present]
# Runtime
<runtime facts>
# Project memory (ETERE.md)
<project memory>
# Active Skills
<skills block>
```

Project memory and runtime facts sit **after** the base/sub-agent instruction and
**before** `# Active Skills`. Each block is omitted entirely when its string is
empty/absent.

#### `DispatchService` plumbing

In both `handle()` and `resume()` (both assemble the prompt):

1. Resolve `root = this.deps.projectRootFor?.(sessionRecord?.workspaceId) ?? null`.
2. `const projectMemory = readProjectMemory(root)`.
3. Build `runtimeFacts` from the server clock (UTC ISO) and the resolved
   `providerName` (already computed as `transport:model`).
4. Pass both into `assemble(...)`.

Fresh read on every dispatch (local file, negligible cost) so edits are always live.

## Error handling

- No workspace on the session, or no resolvable root → `projectMemory` is `null` →
  no injection (silent). Runtime facts are still injected.
- `ETERE.md` unreadable (permissions) / absent → treated as `null`; dispatch
  proceeds normally.
- Oversized file → truncated with a notice; never silently dropped.

## Testing

- **`project-memory.test.ts`** — reads `<root>/ETERE.md`; `null` on missing
  root / absent / empty file; truncation + notice past the cap; respects exact root.
- **`prompt-assembler.test.ts`** — runtime facts and project memory injected at the
  correct position; both omitted when empty; correct ordering with and without a
  sub-agent; existing skills-block behavior unchanged.
- **`dispatch.service.test.ts`** — resolves the root from the session's workspace
  via `projectRootFor`; no project-memory injection when the session has no
  workspace or the file is absent; runtime facts always present; `resume()` path
  covered too.
- **Seed/discovery** — the new `init` default is covered by existing seed/discovery
  tests (valid frontmatter, copied idempotently).

## Out of scope

- A UI affordance to run init (the skill is the trigger).
- Cross-workspace index / dashboard of ETERE.md files.
- Automatic regeneration / staleness detection.
- Consuming `ETERE.md` outside the dispatch system instruction.
