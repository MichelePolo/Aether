# Skill Smith — portable bundle

Two artefacts that ship together:

- **the skill** `skills/skill-smith/` — how to author, audit and package Agent
  Skills. Entry point `SKILL.md`, with eight reference files, three
  zero-dependency Node scripts and three templates.
- **the agent** `agents/skill-smith.md` — a subagent that runs the process with
  the user and delegates the method to the skill.

The skill is useful on its own. The agent without the skill is an empty shell —
it deliberately contains no method.

```
skill-smith/
├── .claude-plugin/plugin.json      Claude Code plugin manifest
├── agents/skill-smith.md           Claude Code subagent
└── skills/skill-smith/
    ├── SKILL.md                    the entry point
    ├── references/                 loaded only on the branch the request selects
    ├── scripts/                    new-skill, validate-skill, package-skill
    ├── assets/templates/           SKILL.md, reference and evals starters
    └── agents/openai.yaml          Codex harness config
```

**Requirements:** Node.js 18+ for the three scripts. Nothing else — no
`npm install`, no Python, no bash.

## Claude Code — as a plugin

Skill and agent together, which is what the plugin format is for.

```bash
# try it in one session
claude --plugin-dir /path/to/skill-smith

# or install it permanently for yourself
cp -r skill-smith ~/.claude/skills/skill-smith
# loads on the next session as skill-smith@skills-dir
```

The agent appears as `@skill-smith` in the mention typeahead (namespaced
`skill-smith:skill-smith` when loaded as a plugin), and the skill as
`/skill-smith`.

## Claude Code — by hand

If you would rather not use the plugin format, the two halves go to two places:

```bash
cp -r skill-smith/skills/skill-smith ~/.claude/skills/skill-smith
cp    skill-smith/agents/skill-smith.md ~/.claude/agents/skill-smith.md
```

Swap `~/.claude/` for `<repo>/.claude/` to share them with everyone who clones
the project. Project-scope skills require workspace trust; personal ones do not.

## Codex

Codex reads the same layout, and has no separate agent file — `agents/openai.yaml`
inside the skill carries the harness config.

```bash
# personal
cp -r skill-smith/skills/skill-smith ~/.agents/skills/skill-smith

# or per repository
mkdir -p .agents/skills && cp -r skill-smith/skills/skill-smith .agents/skills/skill-smith
```

Invoke it explicitly with `$skill-smith`, or let Codex pick it up on its own —
`policy.allow_implicit_invocation` is `true`.

`agents/skill-smith.md` has no meaning here; leave it behind or ignore it.

## claude.ai and the Skills API

These accept the skill only — they have no subagent concept — and validate a
strict frontmatter subset. The skill already restricts itself to the six spec
fields, so it uploads unchanged.

```bash
node skill-smith/skills/skill-smith/scripts/package-skill.mjs \
  skill-smith/skills/skill-smith --out skill-smith.zip
```

The script validates before packaging and refuses to build an archive that
would be rejected on upload.

## Any other agent product

The skill follows the [Agent Skills](https://agentskills.io) specification, so
anything implementing that standard reads it as-is. The agent is a plain
Markdown file with `name` and `description` frontmatter; paste its body into
whatever your product calls a system prompt.

## Verifying what you got

```bash
node skill-smith/skills/skill-smith/scripts/validate-skill.mjs \
     skill-smith/skills/skill-smith
```

Exit 0 means structurally conformant. Warnings are fine — `agents/openai.yaml`
is reported as an orphan because no Markdown file points at it, which is correct
for a file the harness reads rather than the model.

---

This bundle is generated. Do not edit it in place: change `bundle/sources/` or
`server/skills/defaults/skill-smith/` in the Aether repository and run
`npm run bundle`.
