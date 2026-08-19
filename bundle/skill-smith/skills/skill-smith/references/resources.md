# Bundled resources

Read this when deciding whether something should be a script, a reference, or an
asset — and when writing the contract that lets the model use it.

## Which bucket

| Bucket        | Holds                                          | Enters context   |
| ------------- | ---------------------------------------------- | ---------------- |
| `scripts/`    | code the model runs                            | usually never    |
| `references/` | documentation the model reads                  | when read        |
| `assets/`     | files that end up in the output, or are copied | when read/copied |

The distinction is *what happens to the file*, not what it contains. A JSON
schema the model reads to understand a format is a reference; the same schema
copied verbatim into the user's project is an asset.

## Scripts

### Write a script when the step is deterministic

Parsing, validating, counting, converting, formatting, checking a naming rule.
Prose describing a transformation is both longer and less reliable than code
performing it, and the code costs no context at all when it runs without being
read.

Do **not** write a script for anything requiring judgement. A script that tries
to decide whether a description is "good" will be wrong, and the model will
either trust it or ignore it — both bad.

### Give every script a contract in SKILL.md

The model needs four things and none of them are in the source:

```markdown
node scripts/validate-skill.mjs <skill-dir>

Prints one line per problem and exits non-zero if any are errors.
Exit 0 means the skill is structurally conformant — not that it is good.
```

Name, arguments, output shape, meaning of the exit code. With that, the model
never has to open the file.

### Dependencies

Self-contained beats convenient. A script that runs with only the runtime
already required by the host project will still work in a year; one that needs
an install step fails silently in half the environments it lands in.

If a dependency is unavoidable, declare it in the frontmatter `compatibility`
field and fail with a message that names it:

```
error: this script needs `ffmpeg` on PATH (compatibility: requires ffmpeg)
```

Pick the runtime the target environment guarantees. Python is the common default
for standalone skills; a skill shipped inside a Node project should use Node, so
it inherits a runtime that is already a hard requirement. Bash scripts are the
least portable of the three — Windows hosts may have no bash at all.

### Error messages are the interface

The model reads stderr, not the source. Say what failed, where, and what would
fix it:

```
SKILL.md:2  description is 1180 chars (max 1024) — trim to under 500
SKILL.md:8  broken link: references/setup.md does not exist
```

A bare stack trace forces the model to open the script, which is exactly the
cost the script was meant to avoid.

### Paths

Scripts are invoked from an unpredictable working directory. Resolve paths
relative to the script's own location rather than to `process.cwd()`, and take
the target as an explicit argument. Never hardcode an absolute path — the skill
directory moves when the skill is installed, copied, or packaged.

Some hosts substitute a skill-root variable (Claude Code expands
`${CLAUDE_SKILL_DIR}` in both the body and `allowed-tools` rules), which lets a
skill pre-approve exactly its own script:

```yaml
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)
```

That is a platform extension, not spec — see `packaging.md` before relying on it.

### Cross-platform

Skills get run on Linux, macOS and Windows. Use the runtime's path join rather
than string concatenation with `/`, do not assume a case-sensitive filesystem,
do not assume POSIX tools (`sed`, `find`, `xargs`) exist, and when spawning a
subprocess on Windows pass the flag that keeps a console window from flashing
up. A script that only runs on the author's machine is worse than no script.

## References

- One topic per file, named for the situation that sends the model there:
  `aws.md`, `rollback.md`, `csv.md` — not `part-2.md`, not `misc.md`.
- Open a file over ~300 lines with a table of contents.
- Keep them one hop from `SKILL.md`. A reference that only points at another
  reference should be inlined into whichever end has the content.
- Cross-link sparingly and only sideways (`see disclosure.md`), never in a chain
  the model has to walk to reach the answer.
- A reference under ~30 lines belongs in the body.

## Assets

- Templates go in `assets/templates/` and are copied, not rewritten from memory.
  A template the model reconstructs by hand will drift from the one you shipped.
- Give every placeholder an obvious form — `<slug>`, `{{TITLE}}` — and use one
  convention throughout so a naive find-and-replace works.
- Binary assets (fonts, images, icons) are fine, but say in the body what they
  are for; nothing else in the skill can hint at a `.woff2`.
- Do not put example *inputs* in `assets/` if their only purpose is to be read —
  those are references, or eval fixtures under `evals/files/`.

## Keeping the tree honest

Every file in the skill must be reachable from `SKILL.md` by a pointer that says
when to follow it. Two rules follow:

- An **orphan** — a bundled file no pointer names — will never be read. Either
  point at it or delete it.
- An **empty directory** — `scripts/` with nothing in it — is a promise the skill
  does not keep. Remove it.

`scripts/validate-skill.mjs` checks both.
