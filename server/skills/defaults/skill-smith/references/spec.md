# The SKILL.md specification

Normative rules. Quote from here instead of recalling them — the limits are
exact and a validator will reject a skill that misses one.

## Contents

- [Directory structure](#directory-structure)
- [Frontmatter fields](#frontmatter-fields)
- [`name`](#name)
- [`description`](#description)
- [`license`, `compatibility`, `metadata`, `allowed-tools`](#optional-fields)
- [Body](#body)
- [Progressive disclosure budgets](#progressive-disclosure-budgets)
- [File references](#file-references)
- [Platform extensions beyond the spec](#platform-extensions-beyond-the-spec)
- [Aether's parser: two extra constraints](#aethers-parser-two-extra-constraints)

## Directory structure

A skill is a directory containing at minimum a `SKILL.md`:

```
skill-name/
├── SKILL.md          required: frontmatter + instructions
├── scripts/          optional: executable code
├── references/       optional: documentation loaded on demand
├── assets/           optional: templates, images, data files
└── ...               any additional files
```

The three subdirectory names are conventions, not requirements — but they are
conventions every reader and every tool expects, so deviate only with a reason.

## Frontmatter fields

`SKILL.md` opens with a YAML block fenced by `---` on its own line.

| Field           | Required | Constraint                                                                             |
| --------------- | -------- | -------------------------------------------------------------------------------------- |
| `name`          | yes      | 1–64 chars, lowercase alphanumeric and hyphens, must match the directory name           |
| `description`   | yes      | 1–1024 chars, non-empty, states what the skill does and when to use it                  |
| `license`       | no       | license name, or the name of a bundled license file                                     |
| `compatibility` | no       | max 500 chars; environment requirements (product, packages, network access)             |
| `metadata`      | no       | map of string keys to string values, for client-specific data                           |
| `allowed-tools` | no       | space-separated list of pre-approved tools (experimental; support varies by agent)      |

Those six are the whole spec. Any other key is a platform extension — see
[below](#platform-extensions-beyond-the-spec) — and some validators reject
unknown keys outright with `Unexpected key(s) in SKILL.md frontmatter`.

## `name`

- 1–64 characters
- lowercase alphanumeric (`a-z`, `0-9`) and hyphens (`-`) only
- must not start or end with a hyphen
- must not contain consecutive hyphens (`--`)
- must match the parent directory name

```yaml
name: pdf-processing      # valid
name: PDF-Processing      # invalid: uppercase
name: -pdf                # invalid: leading hyphen
name: pdf--processing     # invalid: consecutive hyphens
```

Name it for the job, not for the mechanism: `commit-message-writer` beats
`git-helper`. A name that reads as a verb phrase or a concrete noun phrase gives
the model a second, weaker trigger signal on top of the description.

## `description`

- 1–1024 characters
- describes **what** the skill does and **when** to use it
- carries the keywords the agent matches against the user's request

The description is the only part of the skill that is always resident in
context, and it is the entire basis for the decision to load the rest. It is
the highest-leverage text in the skill; budget real effort for it and see
`description-tuning.md`.

```yaml
# good
description: Extracts text and tables from PDF files, fills PDF forms, and merges PDFs. Use whenever the user mentions PDFs, scanned documents, form filling, or document extraction.

# poor
description: Helps with PDFs.
```

## Optional fields

```yaml
license: MIT
license: Proprietary. LICENSE.txt has complete terms

compatibility: Designed for Claude Code (or similar products)
compatibility: Requires git, docker, jq, and network access
compatibility: Requires Python 3.14+ and uv

metadata:
  author: example-org
  version: "1.0"

allowed-tools: Bash(git:*) Bash(jq:*) Read
```

Most skills need none of these. `compatibility` exists for genuine environment
prerequisites — a skill that shells out to `ffmpeg` should say so; a skill that
only writes Markdown should stay silent. `metadata` keys should be distinctive
enough not to collide with future spec fields, and must never reuse `name` or
`description`.

## Body

Everything after the closing `---`. No format restrictions, but the agent loads
the whole file the moment the skill activates, so length is a real cost paid on
every activation.

Recommended content: step-by-step instructions, worked input/output examples,
and the edge cases that actually bite. See `authoring.md`.

## Progressive disclosure budgets

| Level | What loads                             | When                        | Budget                 |
| ----- | -------------------------------------- | --------------------------- | ---------------------- |
| 1     | `name` + `description`                 | always, for every skill     | ~100 tokens            |
| 2     | the full `SKILL.md` body               | when the skill activates    | < 5000 tokens, < 500 lines |
| 3     | `scripts/`, `references/`, `assets/`   | only when read or executed  | effectively unbounded  |

Level 3 is where depth belongs. A script can even be *executed* without its
source ever entering the context window — the cheapest form of disclosure
available. See `disclosure.md`.

## File references

Use relative paths from the skill root:

```markdown
See [the reference guide](references/REFERENCE.md) for details.
Run `scripts/extract.py` to pull the tables out.
```

Keep references one level deep from SKILL.md. A reference that points at another
reference that points at a third forces the model to load all three to reach the
answer, which defeats the purpose. Absolute paths break the moment the skill is
copied, installed, or packaged, so never use them.

For a reference file longer than ~300 lines, open it with a table of contents so
the model can seek rather than read linearly.

## Platform extensions beyond the spec

Claude Code accepts the six spec fields plus its own extensions, among them:
`when_to_use` (appended to the description in the skill listing; the combined
text is truncated at 1536 characters), `argument-hint` and `arguments` for
`/command`-style invocation, `disable-model-invocation` (only the user may
invoke), `user-invocable: false` (only the model may invoke), `disallowed-tools`,
`model`, `effort`, `context: fork` with `agent` and `background`, `hooks`,
`paths` (glob-gated activation), and `shell`.

These are portable nowhere. claude.ai uploads, the Skills API, and spec
validators accept only `name`, `description`, `license`, `compatibility`,
`metadata` and `allowed-tools`. **Rule of thumb: if the skill may ever leave the
tool it was written for, restrict frontmatter to the six spec fields.**
`packaging.md` maps each distribution target to what it accepts.

## Aether's parser: two extra constraints

Aether discovers skills with a deliberately tiny frontmatter reader
(`server/domain/skills/frontmatter.ts`) that scans the leading `---` block line
by line and keeps only `name` and `description`. Two consequences for any skill
that ships inside Aether:

1. **`description` must be a single line.** YAML folded or literal scalars
   (`>-`, `|`) are not parsed; the description would come out empty and the
   skill would be listed as invalid.
2. **Never use `name` or `description` as a nested key** (for example under
   `metadata`) — the parser is not nesting-aware and would read the nested value
   as the skill's own.

Everything else in the frontmatter is ignored safely, so the spec's optional
fields are free to use.
