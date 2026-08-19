---
name: skill-smith
description: Author, audit, and package Agent Skills that conform to the SKILL.md specification — frontmatter, progressive disclosure, references/, scripts/, assets/, evals, and distribution. Use this skill whenever the user wants to create a new skill, turn a repeated workflow or a grown CLAUDE.md section into a skill, review or repair an existing SKILL.md, tune a description so the skill actually triggers, split an oversized SKILL.md into reference files, or bundle a skill for sharing — even when they only say "make a skill for X", "my skill never fires", or "is this skill any good?".
license: MIT
compatibility: Requires Node.js 18+ for the bundled scripts. No network access needed.
metadata:
  author: aether-core
  version: "1.0"
---

# Skill Smith

Forge skills that a model can actually use: a directory whose entry point is
`SKILL.md`, sized so that almost nothing is loaded until it is needed.

A skill is not documentation. Documentation explains a system to a reader who
chose to open it. A skill has to earn its way into a context window that is
already full — which is why the description does the triggering, the body does
the deciding, and the bundled files do the explaining.

## Route first

Work out what the user is actually asking for, then jump to that row. Read only
the reference the row names; the rest stay on disk.

| The user wants                                   | Do this                                             | Read on demand                  |
| ------------------------------------------------ | --------------------------------------------------- | ------------------------------- |
| A new skill from scratch                          | The forge loop below, all five steps                 | `references/authoring.md`       |
| "Turn what we just did into a skill"              | Mine this conversation for step 1, then the loop     | `references/authoring.md`       |
| A review of an existing skill                     | Run the validator, then the review gate              | `references/review-checklist.md`|
| "It never triggers" / "it triggers too often"     | Rewrite the description only — do not touch the body | `references/description-tuning.md` |
| SKILL.md has grown too long                       | Split by decision boundary, not by word count        | `references/disclosure.md`      |
| Exact frontmatter rules, limits, field meanings   | Quote the spec, do not recall it                     | `references/spec.md`            |
| Scripts, templates, or reference files to bundle  | Pick the right bucket and the right calling contract | `references/resources.md`       |
| Proof that the skill helps                        | Build a small eval set and run with/without          | `references/evaluation.md`      |
| To ship it (Claude Code, plugin, API, Aether)     | Match layout and frontmatter to the target           | `references/packaging.md`       |

## The forge loop

### 1. Capture intent

Get four answers before writing anything. If the conversation already contains
the workflow — the user said "make this a skill" — mine it for the answers and
confirm rather than interrogate.

1. **What should the model be able to do** that it does badly or inconsistently now?
2. **When should this fire?** Collect the user's own phrasings; they become the description.
3. **What does success look like?** A file, a format, a passed check, a diff.
4. **What is already known?** Anything the model reliably does unprompted must
   stay out of the skill — repeating it costs context and buys nothing.

If you cannot name a concrete failure the skill prevents, say so. A skill that
only restates default behaviour makes every future context window worse.

### 2. Choose the shape

Skills come in three shapes. Picking wrong is the most common structural mistake.

- **Single file.** One SKILL.md, no bundled resources. Correct for a procedure
  under ~150 lines with no variants. Do not invent a `references/` directory to
  look thorough.
- **Router.** A short SKILL.md that decides, plus `references/*.md` for each
  branch. Correct when the skill covers variants the model picks between —
  per cloud provider, per file format, per framework. Only the chosen branch
  gets loaded.
- **Tool-backed.** SKILL.md plus `scripts/`. Correct when a step is
  deterministic, repetitive, or error-prone in prose — parsing, validating,
  counting, converting. A script that runs is cheaper and more reliable than
  twenty lines of instructions describing the same transformation.

Budget check before you write: metadata is always resident, the body loads on
every activation, bundled files load only when read. Anything a typical run does
*not* need belongs one level deeper. See `references/disclosure.md`.

### 3. Scaffold

```bash
node scripts/new-skill.mjs <slug> --dir <parent-directory> [--shape single|router|tool]
```

It creates the directory, a SKILL.md from `assets/templates/`, and only the
subdirectories the chosen shape needs. Empty `scripts/` or `assets/` directories
are noise — the scaffolder will not create them unless the shape calls for them.

Writing by hand instead: copy `assets/templates/SKILL.md.template`, and
`assets/templates/reference.md.template` for each reference file. Copy them
rather than reproducing them from memory — a reconstructed template drifts from
the one everything else in this skill assumes.

### 4. Write

Frontmatter, then body.

**Frontmatter.** `name` must equal the directory name: lowercase letters,
digits and single hyphens, 1–64 characters, no leading, trailing or doubled
hyphen. `description` is one line, max 1024 characters, and states *what* the
skill does and *when* to use it — models under-trigger skills, so name the
triggering phrases explicitly and lean toward slightly pushy. Add `license`,
`compatibility` or `metadata` only when they carry real information. Full field
reference and per-platform extensions: `references/spec.md`.

**Body.** Imperative voice, addressed to the model that will execute it. State
why a constraint exists rather than shouting MUST at it — a model that
understands the reason generalises to the case you did not anticipate. Keep it
under 500 lines; when a section stops being a decision and becomes an
explanation, move it to `references/` and leave a pointer that says when to
read it. Patterns, examples and anti-patterns: `references/authoring.md`.

### 5. Validate and iterate

```bash
node scripts/validate-skill.mjs <skill-directory>
```

The validator is mechanical: frontmatter conformance, name/directory agreement,
description length, body size, broken relative links, orphaned bundled files,
empty directories. It cannot tell you whether the skill is any good — that is
the review gate in `references/review-checklist.md`, and, when the output is
objectively checkable, an eval set built per `references/evaluation.md`.

Iterate on evidence, not vibes: run a realistic prompt with the skill and the
same prompt without it. If the outputs are indistinguishable, the skill is not
earning its context. Delete it or sharpen it.

## Non-negotiables

- `name` in frontmatter equals the directory name, exactly.
- `description` is one line and says both what and when.
- The directory is self-contained: relative paths only, no absolute paths, no
  references to files outside the skill directory.
- Nothing in the skill surprises a user who read its description. No hidden
  network calls, no credential access, no destructive commands the description
  does not imply. Decline to build a skill designed to mislead.
- Every bundled file is reachable from SKILL.md by a path the model is told when
  to follow. An unreferenced file will never be read.

## Working with the user

The people who write skills range from "opened a terminal last week" to career
engineers. Read the cues. Terms like *progressive disclosure*, *frontmatter* and
*eval* are worth a half-sentence gloss the first time unless the user has
already used them. Show the finished SKILL.md rather than describing it — it is
short by construction, and reading it is the fastest review.

## What is in this skill

```
skill-smith/
├── SKILL.md                      this router
├── references/
│   ├── spec.md                   normative frontmatter + layout rules
│   ├── authoring.md              how to write the body
│   ├── disclosure.md             the three levels and how to split
│   ├── description-tuning.md     making a skill trigger when it should
│   ├── resources.md              scripts/, references/, assets/ conventions
│   ├── evaluation.md             proving the skill helps
│   ├── packaging.md              shipping to each distribution target
│   └── review-checklist.md       the quality gate
├── assets/templates/             SKILL.md, reference, and evals starters
└── scripts/
    ├── new-skill.mjs             scaffold a skill directory
    ├── validate-skill.mjs        mechanical conformance check
    └── package-skill.mjs         zip for upload/distribution
```
