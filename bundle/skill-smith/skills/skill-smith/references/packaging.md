# Shipping a skill

Read this when the skill is finished and has to reach a runtime. Each target
accepts a different frontmatter subset and resolves the invocation name
differently; picking the target *before* writing the frontmatter avoids a
rewrite.

## Contents

- [Target matrix](#target-matrix)
- [Claude Code: personal and project skills](#claude-code-personal-and-project-skills)
- [Claude Code: plugin skills](#claude-code-plugin-skills)
- [claude.ai upload and the Skills API](#claudeai-upload-and-the-skills-api)
- [Aether](#aether)
- [Zipping](#zipping)
- [Pre-flight checklist](#pre-flight-checklist)

## Target matrix

| Target                            | Location                                   | Frontmatter accepted                    |
| --------------------------------- | ------------------------------------------ | --------------------------------------- |
| Claude Code, personal             | `~/.claude/skills/<slug>/`                 | spec fields + Claude Code extensions    |
| Claude Code, project              | `<repo>/.claude/skills/<slug>/`            | spec fields + Claude Code extensions    |
| Claude Code plugin                | `<plugin>/skills/<slug>/`                  | spec fields + Claude Code extensions    |
| claude.ai upload / Skills API     | uploaded `.zip`                            | **only** `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` |
| Aether                            | `${AETHER_LIBRARY_DIR}/skills/<slug>/`     | `name` + `description` are read; the rest is ignored safely |

A skill that might travel should restrict itself to the six spec fields. Extra
keys are not merely ignored on the strict paths — they are rejected:

```
Unexpected key(s) in SKILL.md frontmatter: argument-hint.
Allowed properties are: allowed-tools, compatibility, description, license, metadata, name
```

## Claude Code: personal and project skills

Drop the directory in `~/.claude/skills/` (yours alone) or `.claude/skills/`
(checked into the repo, shared with everyone who clones it).

The command you type comes from the **directory name**; the frontmatter `name`
only sets the display label in listings. Rename the directory to rename the
command.

Two extension fields change who can invoke it:

- `disable-model-invocation: true` — only the user, via `/<name>`. The
  description stays out of context entirely. Use it for anything with side
  effects: deploys, commits, sends.
- `user-invocable: false` — only the model. The description stays in context but
  the skill never appears in the `/` menu. Use it for background knowledge that
  is not a meaningful action.

`allowed-tools` pre-approves tools **for the turn that invokes the skill only**;
the grant clears on the next user message. Because a project skill's
`allowed-tools` applies even in an untrusted folder, review that field in any
skill you did not write before running Claude Code in its repository.

## Claude Code: plugin skills

In a plugin, the command is namespaced (`/my-plugin:review`) and the frontmatter
`name` replaces the last segment. Two consequences: `name` is load-bearing here
in a way it is not for personal skills, and a plugin skill's `name` no longer
has to equal its directory name — though keeping them equal stays the right
default, because every other target requires it.

## claude.ai upload and the Skills API

Package the directory as a zip whose single top-level entry is the skill folder,
then upload it. Only the six spec fields validate. Claude Code-only body
features — dynamic command injection, `${CLAUDE_SKILL_DIR}` substitution,
`$1`/`$ARGUMENTS` placeholders — silently do nothing here, so a skill that
depends on them will misbehave rather than fail loudly. Strip them, or keep a
separate build for that target.

## Aether

Aether reads skills from `${AETHER_LIBRARY_DIR}/skills/` (see
`server/domain/skills/skills.paths.ts`). Three things are worth knowing:

- **Bundled defaults.** Directories under `server/skills/defaults/` are copied to
  `dist/skills/defaults/` at build time and seeded into the user's skills
  directory on boot. Seeding is non-destructive: a default is copied only when
  no directory of that slug exists, so user edits and deliberate deletions
  survive upgrades — and a fix to a shipped default will **not** reach users who
  already have it.
- **Drafts.** `skills/.drafts/<slug>/` is a staging area. Dot-directories are
  excluded from discovery, so a draft is inert until promoted.
- **Pinning is the disclosure switch.** An enabled skill contributes only its
  name, description and directory path to the prompt; a *pinned* skill has its
  whole `SKILL.md` inlined. Pin only skills that should apply to every turn —
  pinning a router-shaped skill defeats the routing.

Aether's frontmatter reader keeps only `name` and `description`, one per line.
Keep the description on a single line and never nest a `name:` or
`description:` key under `metadata:`. Full detail in `spec.md`.

## Zipping

```bash
node scripts/package-skill.mjs <skill-dir> [--out <file.zip>]
```

It validates first and refuses to build a package that would be rejected on
upload, excludes `.git`, `node_modules`, `evals/`, `*-workspace/` and OS cruft,
and writes a zip whose single top-level entry is `<slug>/`.

## Pre-flight checklist

- [ ] `scripts/validate-skill.mjs` exits 0.
- [ ] Frontmatter matches what the chosen target accepts.
- [ ] `name` equals the directory name (and, for a plugin, the command you want).
- [ ] No absolute paths anywhere in the skill.
- [ ] Scripts run from a directory other than the skill root.
- [ ] Declared prerequisites are real and in `compatibility`.
- [ ] Nothing in the skill would surprise someone who only read the description.
- [ ] `license` set if the skill leaves the organisation that wrote it.
