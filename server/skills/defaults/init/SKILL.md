---
name: init
description: Analyze the current workspace and write or update ETERE.md, Aether's project-memory file at the project root. Use when the user asks to initialize the project, generate ETERE.md, or document the codebase for future agents.
---

# Initialize project memory (ETERE.md)

Produce `ETERE.md` at the project root: a compact, durable brief that lets a
future agent become productive in this repo fast. Write it for an agent, not for
human onboarding — capture what is NOT obvious from a glance at the code.

## Process
1. **Explore before writing (read-only).** Survey the structure, the manifest
   (`package.json` or equivalent), the README, and how the project is built,
   tested, linted, and run. Note the architecture, the conventions, and the
   non-obvious gotchas.
2. **Locate the root.** Write `ETERE.md` at the root the filesystem tool is
   rooted at (the active workspace). One `ETERE.md` per project.
3. **Write the metadata header** (see below), copying `Current time` and
   `Active model` **verbatim** from the `# Runtime` block in your system prompt.
   Never invent the timestamp or the model id.
4. **Write the body**: what the project is; the canonical commands
   (build/test/lint/run); the architecture in brief; the conventions; the traps.
   Do not restate what is obvious from the code. Keep it tight.
5. **Regenerating?** If `ETERE.md` already exists, treat it as an update: keep the
   original `Creato` date, bump the version counter (`v2`, `v3`, …), and append a
   row to the version history. The version table is a **FIFO window of the last 5
   versions** — drop the oldest row(s) so at most 5 remain. The counter never
   resets, so the table may show e.g. `v3..v7`.

## Header layout
```markdown
# ETERE.md — <project name>

> Aether project memory — generated automatically.
>
> - **Progetto:** <name, from the manifest or the directory>
> - **Creato:** <ISO timestamp, from the first generation>
> - **Modello generatore:** <latest version's model>
>
> #### Storico versioni (ultime 5)
> | Versione | Data | Modello |
> |---|---|---|
> | v1 | <ISO timestamp> | <transport:model> |
```

## Rules
- Describe this as "Aether's project memory". Never reference a vendor or product.
- `Modello generatore` mirrors the most recent version row's model.
- Prefer accuracy over completeness: omit a section rather than guess.
