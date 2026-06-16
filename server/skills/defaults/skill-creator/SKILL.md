---
name: skill-creator
description: Create a new, self-contained skill — a directory with a SKILL.md plus any referenced resources, reference docs, and scripts. Use when generating a skill's files from an agreed design.
---

# Skill Creator

Generate a self-contained skill directory from an agreed design.

## What a skill is
A directory whose entry point is `SKILL.md`. The SKILL.md has YAML frontmatter
with `name` (must equal the directory name) and `description`, followed by the
instructions. It may reference sibling files: `resources/`, `references/`,
`scripts/`. Everything the skill needs must live inside its own directory.

## Procedure
1. Choose a kebab-case slug; create `<slug>/`.
2. Write `<slug>/SKILL.md` with frontmatter (`name: <slug>`, a one-line
   `description` that states WHEN to use it) and a focused body.
3. Add only the resources the skill actually needs; reference them by relative path.
4. Keep the SKILL.md tight — push depth into referenced files for progressive disclosure.

## Quality bar
- `name` in frontmatter matches the directory name exactly.
- `description` is specific about when the skill applies (triggers).
- No external/absolute paths — the directory is self-contained.
