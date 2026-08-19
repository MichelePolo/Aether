# The review gate

Read this when auditing a skill — your own before shipping, or someone else's.

Run `node scripts/validate-skill.mjs <dir>` first. It settles everything
mechanical, so this pass can spend its attention on the parts a program cannot
judge. Work top-down: a skill that fails section 1 or 2 does not need sections
4 onward, because it is going to be rewritten or deleted.

## 1. Does it earn its context?

- [ ] Name a concrete failure the skill prevents. If you cannot, the skill is
      restating default behaviour and should be deleted.
- [ ] Would the model produce a materially different answer without it? When in
      doubt, run one prompt both ways — `evaluation.md`.
- [ ] Is any part of the body something the model already does unprompted? Cut it.
- [ ] Is this one skill, or two wearing a trench coat? Two unrelated jobs mean a
      description that matches neither cleanly.

## 2. Will it fire at the right time?

- [ ] The description names what the skill does in concrete verbs.
- [ ] It names at least three triggering situations, in the user's vocabulary.
- [ ] It does not overlap a neighbouring skill without an explicit exclusion.
- [ ] It contains no instructions — those cost every conversation and help none.
- [ ] It is one line and under 1024 characters, primary use case first.

Details and a test procedure: `description-tuning.md`.

## 3. Is the disclosure right?

- [ ] Body under 500 lines; nothing in it that only some runs need.
- [ ] Every reference file corresponds to a branch the model can identify from
      the request *before* opening the file.
- [ ] Every pointer states the condition for following it, not just the path.
- [ ] No reference chains — references are one hop from `SKILL.md`.
- [ ] No orphan files, no empty directories, no reference under ~30 lines.
- [ ] Nothing duplicated between body and references; they will drift.

Details: `disclosure.md`.

## 4. Is the body written for a model mid-task?

- [ ] Imperative voice throughout.
- [ ] Constraints carry their reason, so they generalise past the cases you
      thought of.
- [ ] Output formats are shown as literal templates, not described.
- [ ] Branching is in tables, not nested prose conditionals.
- [ ] Failure modes are named — what going wrong looks like, and what it means.
- [ ] Specifics are real: paths, flags, table names and tool names verified to
      exist, not remembered.
- [ ] No motivation section, no hedging, no filler summary.

Details: `authoring.md`.

## 5. Do the resources hold up?

- [ ] Every script has a contract in the body: invocation, output, exit code.
- [ ] Scripts resolve paths from their own location and take the target as an
      argument; no absolute paths, no `cwd` assumptions.
- [ ] Errors print actionable messages on stderr, not stack traces.
- [ ] Dependencies beyond the guaranteed runtime are declared in
      `compatibility` and fail with a message naming them.
- [ ] Scripts run on Linux, macOS and Windows — path joins, no assumed POSIX
      tools, no assumed case sensitivity.
- [ ] Templates are copied, not reconstructed from memory, and use one
      placeholder convention.

Details: `resources.md`.

## 6. Is it safe and honest?

- [ ] Nothing in the skill would surprise a user who read only its description.
- [ ] No network calls, credential reads, or destructive commands the
      description does not imply.
- [ ] `allowed-tools`, if present, grants the narrowest set that works — and
      you would be comfortable with it applying in an untrusted repository.
- [ ] No embedded secrets, tokens, or internal hostnames.
- [ ] The skill is not designed to mislead a user or evade a control. Decline to
      build or approve one that is.

## 7. Will it survive?

- [ ] Self-contained: it works after being copied elsewhere.
- [ ] Frontmatter matches every target it will ship to — `packaging.md`.
- [ ] It quotes as little of the surrounding codebase as possible, pointing
      instead, so it does not rot on the next refactor.
- [ ] `metadata.version` bumped if anything downstream pins it.

## Reporting

Report findings most-severe first, each as one line: file, what is wrong, and
the fix.

```
SKILL.md          description names no triggering situation → add the three phrasings from the interview
references/aws.md 340 lines, no table of contents → add one, or split rollback out
scripts/run.sh    assumes bash → will not run on Windows; port to Node or declare in compatibility
```

Then give a verdict: **ship**, **ship after these fixes**, or **rewrite** — and,
when the answer is rewrite, say which of sections 1–3 it failed. A skill that
fails section 1 should be deleted rather than rewritten.
