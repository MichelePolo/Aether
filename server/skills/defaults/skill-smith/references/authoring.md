# Writing the body

Read this while drafting or rewriting the Markdown that follows the frontmatter.

## Contents

- [Who you are writing for](#who-you-are-writing-for)
- [Voice](#voice)
- [Explain why, do not shout](#explain-why-do-not-shout)
- [Structure that survives contact](#structure-that-survives-contact)
- [Pattern: pinning an output format](#pattern-pinning-an-output-format)
- [Pattern: worked examples](#pattern-worked-examples)
- [Pattern: decision tables](#pattern-decision-tables)
- [Pattern: naming the failure](#pattern-naming-the-failure)
- [Generality without vagueness](#generality-without-vagueness)
- [Anti-patterns](#anti-patterns)
- [Before and after](#before-and-after)

## Who you are writing for

The reader is a model that already knows how to program, write, and use tools,
and that will read this text exactly once, mid-task, with a user waiting. It
does not need to be taught what JSON is. It needs the specifics of *this* job:
the convention nobody documents, the step everyone forgets, the format the
downstream system actually accepts.

Anything the model already does reliably without the skill is pure cost. Cut it.

## Voice

Imperative, second person implied, present tense.

```markdown
Run the validator before opening a pull request.        # yes
You should probably run the validator at some point.    # no
The validator can be run by the assistant.              # no
```

Prefer concrete nouns over categories: "the `_migrations` table" beats "the
relevant metadata store". Specificity is what makes a skill worth loading.

## Explain why, do not shout

A model given a reason generalises to the case you did not anticipate. A model
given an all-caps command follows it exactly where you predicted and nowhere
else.

```markdown
# brittle
ALWAYS add a new migration file. NEVER edit an existing one.

# generalises
Add a new numbered migration rather than editing an existing one: applied
migrations are recorded in `_migrations` and never re-run, so an edit silently
does nothing on any database that has already seen it.
```

Reserve emphatic phrasing for the handful of rules where the failure is silent,
destructive, or expensive — and even then, still give the reason.

## Structure that survives contact

- Lead with the decision the model has to make first, not with background.
- One heading per decision or phase; a heading the model would never navigate to
  should not exist.
- Numbered steps for sequences, tables for branches, bullets for constraints.
- Put the constraint next to the step it constrains. A "Notes" section at the
  bottom gets read after the mistake has been made.
- End sections where the useful content ends. Filler summaries dilute.

## Pattern: pinning an output format

When the output shape matters, show it rather than describing it:

```markdown
## Report structure

Use this exact template:

# [Title]
## Executive summary
## Key findings
## Recommendations
```

A literal template is unambiguous, and a model reproduces structure far more
faithfully from an example than from a prose description of one.

## Pattern: worked examples

Two or three examples spanning the interesting range beat a paragraph of rules.
Include at least one that is *not* the obvious case.

```markdown
## Commit message format

Input:  Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication

Input:  Reverted the caching change from last week, it broke staging
Output: revert(cache): drop request-level memoisation
```

If the skill produces files, put a full realistic sample in `assets/` and point
at it — a truncated example in the body teaches truncation.

## Pattern: decision tables

Whenever the instruction is "it depends", a table is denser and less ambiguous
than nested prose conditionals:

```markdown
| Situation                        | Do                                  |
| -------------------------------- | ----------------------------------- |
| Schema change needed             | Add `NNN_name.sql`, never edit one   |
| Column only needs a default      | Application-level default, no migration |
| Data backfill over 10k rows      | Migration plus a background job      |
```

## Pattern: naming the failure

State what going wrong looks like, so the model can recognise it mid-task:

```markdown
If the provider registry comes back empty, the credential did not resolve —
check the env var before assuming the model id is wrong.
```

Failure descriptions are the highest-value sentences in most skills, because
they are exactly what is missing from the model's priors.

## Generality without vagueness

Write the rule, then ground it in one example — not the reverse. A skill built
entirely around one worked example teaches the model to pattern-match that
example and fail on the second case. A skill with only abstract rules gives it
nothing to anchor on. Rule first, one example, move on.

## Anti-patterns

- **Restating defaults.** "Write clean, readable code." The model does this
  already; the line costs context and signals the skill has nothing to say.
- **Motivation sections.** Why the skill exists belongs in a README or a commit
  message, never in the body.
- **Hedging.** "You may want to consider possibly validating." Either it is a
  step or it is not.
- **Unreachable detail.** Twelve edge cases inline, of which any run hits one.
  That is what `references/` is for.
- **Tool-name drift.** Referring to tools, flags, or paths that do not exist in
  the target environment. Verify before writing them down.
- **Stale coupling.** Quoting a file's contents instead of pointing at it. The
  copy will drift; the pointer will not.

## Before and after

```markdown
# before — 6 lines, ~0 information
## Testing
It's very important to test your code. You should write tests for the
functionality you add. Make sure the tests pass before you commit. Testing
is a critical part of software development and helps prevent regressions.
```

```markdown
# after — 4 lines, all of it non-obvious
## Testing
Tests are colocated as `*.test.ts` next to the source and run under two Vitest
projects: `frontend` (jsdom, `src/**`) and `backend` (node, `server/**`).
`globals` is on, so `describe`/`it`/`expect` need no import. Coverage
thresholds of 80% are enforced on `server/domain/**` and `src/stores/**`.
```

The second version is shorter and is the only one worth loading.
