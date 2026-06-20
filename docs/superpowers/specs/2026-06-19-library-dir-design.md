# Library directory — data-agnostic home for skills (and future agents) — Design

**Date:** 2026-06-19
**Status:** approved (design), pending implementation plan

## Goal

Introduce a dedicated, **data-agnostic** library directory that holds Aether's
authorable material — skills today, file-based agents in the future — separate
from `AETHER_DATA_DIR` (which keeps the SQLite DB, key vault and daemon file).

This is **Spec 1 of 2**. It is the foundation for Spec 2 (race-free per-context
workspace rooting): Spec 2 will grant every rooted filesystem instance access to
the whole `<libraryDir>`, so skills and future agents stay reachable from any
workspace context **without** exposing the sensitive `data/` directory (DB,
vault). Building the library dir first is what makes that grant clean.

### Why this exists (the coupling)

Skills are authored/edited by built-in agents (e.g. `skill-smith`) through the
**filesystem MCP tool**, writing drafts under the skills directory. Today that
directory lives at `${AETHER_DATA_DIR}/skills`, and it only works because the
filesystem server happens to be rooted at `process.cwd()` (the install dir) when
no workspace is selected — a fragile coincidence that already breaks with a
workspace selected or a custom `AETHER_DATA_DIR`.

Spec 2 makes filesystem grants **per-workspace**. If the authorable material
stayed under `data/`, granting it would mean granting the same directory that
holds the DB and key vault. Moving it to a dedicated `<libraryDir>` lets Spec 2
always-allow exactly that one agnostic location.

## Non-goals

- Filesystem rooting / grant changes — that is **Spec 2**.
- File-based agents — agents remain SQLite-backed today (`subagents`,
  `subagent_skills`, `subagent_tools`). This spec only **reserves** the
  `agents/` subdirectory for the future; no code reads it yet.
- Moving the DB, key vault, or daemon file — those stay in `AETHER_DATA_DIR`.

## Design

### A. Location resolution + config

Add `libraryDir` to `AppConfig` (`server/config.ts`), resolved as:

1. `AETHER_LIBRARY_DIR` if set, else
2. an OS per-user app-data path via a new `defaultLibraryDir()` helper:

| `os.platform()` | Default |
|---|---|
| `win32` | `%APPDATA%\Aether` (fallback `path.join(os.homedir(), 'AppData', 'Roaming', 'Aether')`) |
| `darwin` | `~/Library/Application Support/Aether` |
| other (linux/unix) | `${XDG_DATA_HOME:-~/.local/share}/aether` |

Brand dir is `Aether` on Windows/macOS, `aether` (lowercase, XDG idiom) on Linux.
The location persists across reinstalls and is independent of `AETHER_DATA_DIR`.

### B. Layout + path helpers

```
<libraryDir>/
  skills/        material skills (one dir each) + .drafts/ (drafts)   ← relocated
  agents/        created empty; reserved for future file-based agents
```

In `server/domain/skills/skills.paths.ts`:
- `skillsDirFor(libraryDir)` — now derives from `libraryDir` instead of `dataDir`
  (`${libraryDir}/skills`). `draftsDirFor` follows (`${libraryDir}/skills/.drafts`).
- add `agentsDirFor(libraryDir)` → `${libraryDir}/agents`.
- `defaultsDir()` (bundled defaults shipped with the app) is unchanged.

Skill enabled/pinned **state** stays in SQLite (`skill_state`, keyed by skill
name). Relocation does not rename anything, so state survives untouched.

### C. One-time relocation migration (boot)

In `bootstrap()`, **before** seeding:

1. If `${libraryDir}/skills` does **not** exist **and** `${dataDir}/skills`
   exists → **move** `${dataDir}/skills` → `${libraryDir}/skills`.
2. `mkdirSync` (recursive) for `skills/` and `agents/`.
3. `seedDefaultSkills(defaultsDir(), skillsDirFor(libraryDir))` (idempotent —
   skips existing).

The move is **automatic on first boot**, no user intervention. It is idempotent:
the "destination absent" guard ensures it runs exactly once.

**Cross-volume safety:** `fs.renameSync` throws `EXDEV` when `dataDir` and
`libraryDir` are on different volumes (common: `data/` in the repo, library in
AppData). The migration must fall back to **copy-then-remove**. The existing
`moveDirSync` in `skills.service.ts` is extracted into a shared helper
(`server/domain/skills/fs-move.ts`) and verified/extended to handle `EXDEV`.
Both call sites (skill promote + boot migration) use the one helper.

### D. Wiring & what stays put

- `server/index.ts`: resolve `libraryDir`; run the relocation migration; seed
  into `skillsDirFor(libraryDir)`; create `agentsDirFor(libraryDir)`; construct
  `new SkillsService(skillStateStore, libraryDir)`.
- Stays in `dataDir`: `aether.sqlite`, key vault, daemon file.
- **Error handling:** if `libraryDir` is not writable, fail fast at boot with a
  clear message (do not silently fall back).

### E. Testing

- `defaultLibraryDir()` for all three platforms (mock `os.platform` / env) and
  the `AETHER_LIBRARY_DIR` override.
- Relocation: moves existing skills; idempotent on second boot; `EXDEV`
  copy-then-remove fallback; no-op when `${dataDir}/skills` is absent.
- Seeding lands in the new location; `SkillsService` discovers skills/drafts
  under `${libraryDir}/skills`.
- `agentsDirFor` directory is created.

## Risks / open points

- **Existing users with custom skills:** the move preserves their dirs; SQLite
  skill-state keys (names) are unchanged, so toggles/pins survive.
- **Packaged/prod paths:** `defaultsDir()` resolution is unchanged; only the
  destination (library) moves.
- **Spec 2 dependency:** Spec 2 always-allows `<libraryDir>` (parent), covering
  `skills/` and `agents/` in a single grant, agnostic from `data/`.
