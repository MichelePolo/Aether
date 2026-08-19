# Proving the skill helps

Read this when the skill's output is objectively checkable and the user wants
evidence — or when a skill has been rewritten and nobody can say whether it got
better.

## When to bother

| Skill produces                                   | Evaluate?                    |
| ------------------------------------------------ | ---------------------------- |
| A file, a diff, a structured record, a passing check | Yes — the check is mechanical |
| A fixed procedure with observable steps           | Yes — assert on the steps     |
| Prose style, taste, visual design                 | Usually not — judge by reading |
| A one-off internal convention nobody else runs    | Not worth the setup           |

Say so plainly when evals are not worth it. Setting up a benchmark for a
subjective skill produces numbers that mean nothing and cost an afternoon.

## The only comparison that matters

Run the same prompt twice: **with** the skill and **without** it. If the outputs
are indistinguishable, the skill is not earning the context it costs — sharpen
it or delete it. Everything else in this file is machinery around that one
comparison.

When improving an existing skill, the baseline is the *old version*, not the
absence of a skill: snapshot the skill directory before editing, and point the
baseline run at the snapshot.

## Writing the cases

Aim for 3–5 to start. Each must be something a real user would actually type,
not a description of a test.

```
good:  "Our staging deploy failed with a migration error, can you sort it out?"
bad:   "Test the migration-repair skill's error path"
```

Cover the obvious case, one variant that exercises a different branch of the
skill, and one near-miss that should *not* engage the skill at all. The
near-miss catches over-triggering, which no with/without comparison will.

## `evals/evals.json`

Store cases inside the skill directory so they travel with it.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "The task, phrased as a user would phrase it",
      "expected_output": "Human-readable description of success",
      "files": ["evals/files/sample.csv"],
      "expectations": [
        "The output file is valid CSV with a header row",
        "The skill ran scripts/convert.mjs rather than transforming by hand"
      ]
    }
  ]
}
```

- `id` — unique integer.
- `prompt` — the task, verbatim.
- `expected_output` — what success looks like, for a human reader.
- `files` — optional input fixtures, paths relative to the skill root.
- `expectations` — individually checkable statements. Write these *after* the
  first run, not before: the first run shows you which failures are real.

A starter file is in `assets/templates/evals.json.template`.

## Writing expectations that discriminate

An expectation that passes with and without the skill measures nothing.

```
weak:    "The output is a CSV file"                  # true either way
strong:  "Currency columns are emitted as integers    # only the skill knows this
          in minor units, not floats"
```

Prefer expectations about *the specific thing the skill knows*: the convention,
the required order, the tool it should have used, the edge case it should have
caught. When an expectation passes in both configurations, delete it or make it
sharper.

Beware expectations that a plausible-looking hallucination would also satisfy.
"Mentions the customer's name" passes on an invented document; "the name matches
the one in `input.csv` row 3" does not.

## Running

For each case, run both configurations and keep the artefacts:

```
<skill-name>-workspace/
└── iteration-1/
    ├── extract-tables/
    │   ├── with_skill/outputs/
    │   └── without_skill/outputs/     (or old_skill/ when improving)
    └── ...
```

Name each case for what it tests, not `eval-0`. Launch the with- and
without-skill runs together rather than in two passes, so drift in the
environment hits both equally.

Record per run: pass rate over the expectations, wall-clock time, and tool-call
count. The last two matter — a skill that raises the pass rate from 35% to 85%
while adding thirteen seconds is a good trade; one that adds four minutes for
five points is not.

## Reading the results

- **Pass rate up, clearly** → keep, then look at the remaining failures for the
  next revision.
- **No difference** → the skill restates what the model already does. Cut it
  down to the part that is genuinely non-obvious, or delete it.
- **High variance across repeats** → the instruction is ambiguous. Find the step
  the runs diverge at and make it explicit; that is a body fix, not a
  description fix.
- **Worse with the skill** → almost always over-specification: the skill forced
  a path that does not fit the case. Loosen the rule and say why it exists.

Run each configuration two or three times before drawing a conclusion. A single
run's difference is noise.

## Iterating

Change **one** thing per iteration — the description, or one section of the body,
or one script. Re-run the same cases. Keep a short log of what changed and what
moved; without it, the third iteration is guesswork.

Stop when the failures left are ones you do not care about. Chasing the last
expectation usually adds length that costs every future run.
