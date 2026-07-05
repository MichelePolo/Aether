# Documentation reorganization — design

**Date:** 2026-07-05
**Goal:** Make the now-public Aether repo navigable and trustworthy: a lean README that leads a developer (human or AI) through a deliberate learning path, current docs separated from historical artifacts, and dead weight (unreferenced images, stale files) removed.

## Decisions (from brainstorming)

- **Language:** bilingual, with **English as the canonical source of truth**. Italian translations live under `docs/it/` and cover only the human-path guides; each carries a "translated — may lag the English original" banner. AI-facing docs (CLAUDE.md, architecture, reference) stay English-only.
- **History:** declared archive, not deletion. `docs/superpowers/` stays where it is (slice specs/plans + roadmap) and gains a README framing it as design history. Stale audits move to `docs/archive/`.
- **Depth:** full path — README → docs index → getting-started → architecture → per-domain guides → reference → development/contributing.

## Target structure

```
README.md                  Lean showcase (EN, IT switcher link at top):
                           what it is, features in brief, 1-line install,
                           link to docs/README.md as "start here"
CONTRIBUTING.md            Translated to EN (GitHub Flow, squash, protected main)
docs/
  README.md                The map. Ordered reading path with one-line "why read this"
                           per doc. This is the navigation spine.
  getting-started.md       Install (one-liner + from source), first dispatch,
                           enabling providers, Fake provider for keyless exploration
  architecture.md          Single-process model, composition root, domain layer,
                           dispatch loop, SSE, persistence/migrations. Written to be
                           equally useful to humans and AI agents.
  guides/
    providers.md           Registry, KeyResolver, sticky selection, openai-compat/vLLM
    key-vault.md           AES-256-GCM vault, env-first resolution, AETHER_VAULT_KEY
    mcp-tools.md           MCP registry, 1-click built-ins, tool-call cap
    breakpoints.md         auto/gate policy, approval flow, 24h timeout, CLI behavior
    workspaces.md          Workspace GUI ↔ filesystem MCP
    history.md             Sessions, forking, export/import, FTS, attachments
    subagents-swarms.md    Cross-model subagents, @mention, swarms
    scheduler.md           Scheduled agents: poller model + the manual-test content
                           salvaged from "SCHEDULER TEST GUIDE.md"
    cli.md                 aether daemon, one-shot, --json, stdin piping
  reference/
    configuration.md       Full env-var table (moves out of README)
    api.md                 REST surface + SSE event vocabulary
    database.md            Schema overview, append-only migrations, FTS, cascade rules
  development.md           Dev commands, two-project Vitest layout, coverage
                           thresholds, import paths, slice workflow, DISABLE_HMR
  it/
    README.md              Indice in italiano (mirror of docs/README.md)
    getting-started.md     + translations of guides/ (banner on each)
    guides/…
  archive/
    README.md              "Point-in-time artifacts; not current documentation"
    2026-05-24-ux-review.md            (from /UX_REVIEW.md)
    aether-code-review.md              (from docs/)
    aether-comprehensive-audit.md      (from docs/)
    aether-killer-features.md          (from docs/)
    e2e-test-plan.md                   (from docs/)
    context-consumption.md, swarms.md  (from docs/ — design notes superseded by guides)
  superpowers/
    README.md              NEW: "development history — specs & plans per slice,
                           kept as design rationale; see docs/ for current docs"
    roadmap.md, specs/, plans/         unchanged
```

## README rewrite

Keep: pitch paragraph, feature bullets (tightened), tech-stack table, 1-line install, minimal "run locally" (3 steps), architecture ASCII sketch (small), project layout.
Move out: full env-var table → `reference/configuration.md`; CLI details → `guides/cli.md`; scripts table → `development.md`.
Add: language switcher line (`🇬🇧 English · 🇮🇹 Italiano → docs/it/README.md`); a "Documentation" section linking the reading path (Start → getting-started → architecture → guides); link to the minisite.
Fix: remove the "Private repo" comment and the `?token=…` from the Codecov badge (public repos don't need it).

## Content sourcing rule

New docs are **distilled from code and CLAUDE.md, verified against the source** — not invented. Where a guide describes behavior (e.g. tool-call cap, vault resolution order), it cites the file (`server/domain/dispatch/dispatch.service.ts`) so both humans and AI can jump to ground truth. No aspirational content: if a feature is planned but absent, it doesn't appear.

## Cleanup

- Delete `docs/Gemini_Generated_Image_h6wth0h6wth0h6wt.png` and `…kxmyum….png` (10 MB total, referenced nowhere).
- Discard untracked `docs/Skill-Smith.png` (not used by repo or site).
- Delete root `SCHEDULER TEST GUIDE.md` after salvaging its content into `guides/scheduler.md`.
- Move `UX_REVIEW.md` to `docs/archive/`.
- CLAUDE.md: update the `docs/` description line to match the new layout.

## AI-readability principles (applied throughout)

1. One canonical language (EN); translations declared derivative.
2. Every doc starts with a 1-2 sentence "what this covers / when to read it".
3. File paths and identifiers in backticks, exact and current — docs act as an index into the code.
4. `docs/README.md` is a flat, ordered map (no deep nesting to crawl).
5. Archive and history are labeled as such at directory level, so agents don't treat stale audits as current truth.

## Out of scope

- Minisite (`site/`, gh-pages) changes — the site already handles IT/EN.
- Translating CLAUDE.md, reference/, or superpowers history.
- Any code changes beyond the Codecov badge line in README.

## Testing / verification

- `npm run lint` still passes (docs-only, but CLAUDE.md edit is included).
- Link check: every relative link in README.md and docs/README.md resolves (simple script or manual pass).
- `git ls-files '*.png'` shows no unreferenced multi-MB images.
