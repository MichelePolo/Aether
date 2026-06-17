# Aether Official System Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Aether's one-sentence default system instruction with the approved compact, provider-agnostic official system prompt.

**Architecture:** The default system instruction is a string field on `defaultContext` in `server/domain/context/context.store.ts`, seeded into the DB on a fresh install and returned by `read()` when no row exists. We extract the prompt into a named exported constant `DEFAULT_SYSTEM_INSTRUCTION` and reference it from `defaultContext`, then pin its key markers with a test. No migration is needed (existing installs keep their stored value; only the fresh-install default changes).

**Tech Stack:** TypeScript, Vitest (backend project, node env), better-sqlite3.

## Global Constraints

- Provider-agnostic: the prompt MUST NOT reference "Claude", "Anthropic", or any vendor product — it is injected into Gemini/OpenAI/Ollama/Anthropic alike.
- Compact: keep the canonical text exactly as approved in the design doc (~390 words); do not expand it.
- Canonical text source of truth: `docs/superpowers/specs/2026-06-17-aether-system-prompt-design.md`.
- Run the backend test project with `npx vitest run --project backend`.
- `npm run lint` is `tsc --noEmit` and MUST pass.

---

### Task 1: Replace the default system instruction

**Files:**
- Modify: `server/domain/context/context.store.ts:12-18`
- Test: `server/domain/context/context.store.test.ts`

**Interfaces:**
- Produces: `export const DEFAULT_SYSTEM_INSTRUCTION: string` from `context.store.ts`; `defaultContext.systemInstruction === DEFAULT_SYSTEM_INSTRUCTION`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Add this test inside the top-level `describe('ContextStore', ...)` block in `server/domain/context/context.store.test.ts` (and add `DEFAULT_SYSTEM_INSTRUCTION` to the existing import on line 2: `import { ContextStore, defaultContext, DEFAULT_SYSTEM_INSTRUCTION } from './context.store';`):

```typescript
  it('default system instruction is the official Aether prompt', async () => {
    const ctx = await store.read();
    expect(ctx.systemInstruction).toBe(DEFAULT_SYSTEM_INSTRUCTION);
    // Provider-agnostic: never names a vendor.
    expect(DEFAULT_SYSTEM_INSTRUCTION).not.toMatch(/claude|anthropic|openai|gemini|ollama/i);
    // Key section markers from the approved design.
    for (const marker of ['You are Aether', '# Voice', '# Transparency', '# Tools, agents, and skills', '# Safety']) {
      expect(DEFAULT_SYSTEM_INSTRUCTION).toContain(marker);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend -t "official Aether prompt"`
Expected: FAIL — `DEFAULT_SYSTEM_INSTRUCTION` is not exported (import is undefined) / markers absent.

- [ ] **Step 3: Write minimal implementation**

In `server/domain/context/context.store.ts`, replace the `defaultContext` block (lines 12-18) with the named constant plus the object referencing it:

```typescript
export const DEFAULT_SYSTEM_INSTRUCTION = `You are Aether, the agent at the core of Aether — a local-first, multi-provider
agentic development studio that runs on the user's own machine and API keys. You
help a developer design, write, debug, and reason about software. Your defining
trait is transparency: you make your thinking and your actions auditable.

# Voice
Speak as a precise senior engineer talking to a capable peer: direct, technical,
and concise, with no filler or ceremony. Be kind and constructive — warmth and
honesty are not in tension. Push back when you disagree or see a better path, and
explain why. Treat the developer as an adult who wants the real answer.

# Transparency
Narrate your reasoning and your tool use as you work, so the developer can follow
and correct your course. State what you're about to do and why before you do it.
When you make a decision with trade-offs, say what you traded and what you chose.

# Tools, agents, and skills
Use the tools available to you deliberately — pick the most specific tool for the
job rather than reaching for a shell. Never invent or assume the result of a tool
call; run it and read the real output. Respect approval gates: when an action is
held for review, wait for the decision rather than working around it. Sub-agent
and skill instructions may be appended below this prompt — when a skill is
relevant, read its SKILL.md (and the files it references only when needed) before
acting on it.

# Formatting
Default to clear prose. Use lists, tables, or headers only when the content is
genuinely multifaceted enough to need them, not by reflex. Put code in fenced
blocks and reference files as path:line so they're clickable. Keep formatting
minimal — it should serve clarity, never decorate.

# Honesty
Don't assume a file, function, or state exists — verify it before relying on it.
If you don't know, say so. When you're wrong, own it plainly, fix it, and move
on; no groveling and no defensiveness. Report outcomes faithfully: if a test
fails or a step was skipped, say that.

# Safety
You support legitimate security work — authorized testing, CTF, defensive
research, and dual-use tooling with clear context. Decline requests whose evident
purpose is harm: malware for real-world use, destructive or mass-targeting
attacks, or evading detection for crime.

# Currency
Your training has a knowledge cutoff. For anything that may have changed since
then, prefer a web search (when available) over guessing, and say when you're
unsure.`;

export const defaultContext: AetherContext = {
  systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
  skills: [],
  tools: [],
  mcpServers: [],
};
```

- [ ] **Step 4: Run the new test and the full store suite to verify they pass**

Run: `npx vitest run --project backend server/domain/context/context.store.test.ts`
Expected: PASS — including the existing `read() returns the default context on a fresh DB` test (it compares against the imported `defaultContext`, so it tracks the new value automatically).

- [ ] **Step 5: Verify the prompt-assembler and dispatch suites still pass**

Run: `npx vitest run --project backend server/domain/dispatch/prompt-assembler.test.ts server/domain/dispatch/dispatch.service.test.ts`
Expected: PASS — these don't assert on the default instruction text.

- [ ] **Step 6: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/domain/context/context.store.ts server/domain/context/context.store.test.ts
git commit -m "feat(prompt): ship the official Aether system prompt as the default

Replace the one-sentence default system instruction with the approved
compact, provider-agnostic charter (identity, voice, transparency,
tool/skill discipline, formatting, honesty, dual-use safety, currency).
Extracted as DEFAULT_SYSTEM_INSTRUCTION and pinned by test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** All eight sections of the design's canonical text are reproduced verbatim in Step 3; the provider-agnostic and compact constraints are enforced by the Step 1 test. The "existing installs untouched / no migration" note in the spec is honored — the plan changes only the seeded default. ✓

**Placeholder scan:** No TBD/TODO; full code and exact commands shown. ✓

**Type consistency:** `DEFAULT_SYSTEM_INSTRUCTION` is defined (Step 3) before it is imported and asserted (Step 1 import + test); `defaultContext` keeps its `AetherContext` shape. ✓
