# Progressive disclosure

Read this when deciding what belongs in the body versus a bundled file, or when
a SKILL.md has outgrown its budget.

## The cost model

Three levels, three very different prices:

| Level | Content                        | Loaded                          | Paid by                                  |
| ----- | ------------------------------ | ------------------------------- | ---------------------------------------- |
| 1     | `name` + `description`         | always, once per session        | **every** conversation, skill used or not |
| 2     | `SKILL.md` body                | on activation                   | every run of this skill                  |
| 3     | `references/`, `assets/`       | when the model reads the file   | only the runs that need that branch      |
| 3     | `scripts/`                     | when executed — source optional | often nothing at all                     |

The asymmetry is the whole point. Level 1 is charged against every conversation
in the product, which is why a bloated description is worse than a bloated body.
Level 3 is charged only against the run that needs it, which is why a variant
the model picks between belongs in a file and not in a conditional paragraph.

## Where a given piece of text goes

Ask what fraction of runs need it.

- **Every run needs it** → body.
- **Some runs need it, and the model can tell which from the request** → a
  reference file, named in a routing table in the body.
- **No run needs to *read* it, only to *apply* it deterministically** → a script.
- **It goes into the output rather than the reasoning** (a template, a
  boilerplate config, a logo) → `assets/`.
- **Nobody needs it** → delete it. Background, rationale for the skill's
  existence, and changelogs are for the repository, not for the context window.

## Splitting a body that got too long

Split at a **decision boundary**, never at a word count. The test: after the
split, can the model tell from the user's request which file to open, using only
what remains in the body? If not, the split is wrong and the model will either
load everything or guess.

Good boundaries — the branches are mutually exclusive and named in the request:

```
cloud-deploy/
├── SKILL.md          workflow + "which provider is this?" routing
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

Bad boundaries — the model must read both halves to know which it needed:

```
my-skill/
├── SKILL.md
└── references/
    ├── part-1.md
    └── part-2.md
```

Other boundaries that work in practice: input format (`csv.md`, `xlsx.md`),
phase of a long workflow (`plan.md`, `migrate.md`, `verify.md`), depth
(`SKILL.md` for the common path, `edge-cases.md` for the rest).

## The routing table pattern

Once a skill has more than two reference files, put a table near the top of the
body and let it carry the branching:

```markdown
| The user wants           | Read                      |
| ------------------------ | ------------------------- |
| To deploy to AWS         | `references/aws.md`       |
| To deploy to GCP         | `references/gcp.md`       |
| To roll back a release   | `references/rollback.md`  |
```

Two properties make it work: every row names a *recognisable situation* rather
than a topic, and the table is exhaustive, so a model that matches no row knows
it is off the skill's map instead of improvising.

## Pointers must say when, not just where

A bare link is a link the model will skip or, worse, follow every time.

```markdown
See references/aws.md.                                   # useless
Read references/aws.md before writing any IAM policy.    # actionable
```

State the trigger condition in the same sentence as the path. The model is
deciding whether to spend context, and it can only decide with a condition.

## Scripts are the cheapest disclosure there is

A script is executed, not read. Its entire body can stay outside the context
window while its effect still happens. Whenever a step is deterministic —
validating a schema, counting lines, converting a format, checking a naming
rule — a script beats prose on both cost and reliability.

Give each script a one-line contract in the body: what to run, what it prints,
what a non-zero exit means. That contract is what the model needs; the source
is not. See `resources.md`.

## Anti-patterns

- **Splitting too early.** A 120-line single-file skill with a `references/`
  directory holding one 30-line file has paid the indirection cost for nothing.
- **Reference chains.** `SKILL.md` → `a.md` → `b.md` loads three files to answer
  one question. Keep references one hop from the body.
- **Duplicating the reference in the body.** Once the body summarises the file
  well enough to act on, the file is dead weight — and the two will drift.
- **Orphan files.** A bundled file no pointer names will never be read. The
  validator flags these; treat it as an error, not a warning.
- **A description that carries instructions.** Level 1 is charged against every
  conversation. Anything that is not *what and when* belongs in the body.

## Sizing rules of thumb

- Body over 500 lines → split; over 300 → look for the boundary.
- Reference file over 300 lines → add a table of contents at the top.
- Reference file under 30 lines → fold it back into the body.
- More than ~7 reference files → the skill is probably two skills.
