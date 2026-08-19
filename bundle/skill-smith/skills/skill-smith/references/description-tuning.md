# Tuning the description

Read this when writing a description, or when a skill fires at the wrong times —
too rarely, too often, or instead of a different skill.

## What the description is actually for

It is the only text the agent sees before deciding whether to load the skill. It
is not a summary for humans, not a tagline, and not a place for instructions.
It answers exactly two questions:

1. **What does this skill do?**
2. **In what situations should it be used?**

Everything else in it is context tax charged against every conversation.

## The default failure is under-triggering

Models are conservative about loading skills. Left to a neutral description,
a genuinely useful skill sits unused while the model improvises a worse answer.
Correct for this deliberately: name the triggering situations in the user's own
words, including the oblique ones, and lean toward slightly pushy phrasing.

```yaml
# under-triggers: accurate, and nothing matches it
description: How to build a simple fast dashboard to display internal data.

# triggers: same skill, situations named
description: Builds simple, fast dashboards for internal data. Use this whenever the user mentions dashboards, data visualisation, internal metrics, or wants to display company data of any kind — even if they never say the word "dashboard".
```

## Anatomy

```
<what it does, concretely>. Use when <situation 1>, <situation 2>, <situation 3>
— even if the user only says "<their likely phrasing>".
```

- **What**: verbs and objects, not adjectives. "Extracts tables from PDFs" beats
  "PDF utilities".
- **When**: situations, not topics. "when a migration fails to apply" beats
  "database stuff".
- **Phrasings**: the literal sentences a user types. These are the strongest
  match signal available and the cheapest to collect — ask the user how they
  would have asked for it.

## Keyword coverage

List the vocabulary the domain actually uses, including synonyms the skill's
own name does not contain. A skill named `pdf-processing` still needs the words
*scanned document*, *form*, *extract*, *merge*, *OCR* in its description,
because that is what users type.

Do not stuff. A description that matches everything gets loaded everywhere and
poisons unrelated conversations — that failure is harder to notice and more
expensive than under-triggering.

## Bounding the scope

When a skill sits next to a plausible neighbour, say where the boundary is:

```yaml
description: Reviews the current diff for correctness bugs. Use when the user asks for a code review or a bug hunt on uncommitted work. Not for style-only cleanups — those go to the formatter.
```

An explicit exclusion is worth several inclusions when two skills compete for
the same requests. Check the neighbours before writing: if two descriptions
overlap, the model's choice between them is a coin flip.

## Length

Hard limit 1024 characters. Practical target 200–500. If the description needs
more than that to be unambiguous, the skill is doing more than one job — split
it. Some listings truncate the combined description text (Claude Code truncates
at 1536 characters including `when_to_use`), so put the primary use case first
and the exotic triggers last.

## Iterating

Descriptions are cheap to test and cheap to change, so test them.

1. Write down 5–10 prompts a real user would send: 3–5 that *should* trigger the
   skill, and 2–5 near-misses that should not.
2. Run them in a fresh session and record what loaded.
3. A should-trigger prompt that missed → the situation is not named in the
   description. Add it in the user's wording, not yours.
4. A near-miss that fired → the description is over-broad. Narrow the verb, or
   add an explicit exclusion.
5. Change the description only. Body edits do not affect triggering, and
   changing both at once tells you nothing about which one helped.

## Checklist

- [ ] One line; no folded or literal YAML scalars.
- [ ] Under 1024 characters, primary use case first.
- [ ] States what the skill does in concrete verbs.
- [ ] Names at least three triggering situations.
- [ ] Contains the phrases a user would actually type.
- [ ] Excludes the neighbouring skill's territory, if there is one.
- [ ] Contains no instructions — those belong in the body.
- [ ] Reads truthfully: nothing in the skill would surprise someone who only
      read this line.
