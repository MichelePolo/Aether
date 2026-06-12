# Skill selection toggle — design

> Status: approved (brainstorming) — ready for implementation plan.
> Date: 2026-06-12.

## Problem

Skills are defined in the sidebar (`SkillsSection`) as a flat list of names. The
user wants to **select / deselect each skill on click**: only selected (enabled)
skills should be used in the model context; deselected ones should be excluded —
without having to delete and re-add them.

Two facts discovered during brainstorming shape the design:

1. **Skills never reached the model.** `assemble()` collects `AssembledPrompt.skills`
   but the dispatch loop only passes `systemInstruction`, `userMessage`, `mcpTools`,
   `subAgent` and attachments to the provider. The `skills` field was unused — so
   today no skill has any effect on the prompt.
2. **Skills are just names** (strings), with no associated content.

## Scope

- **In scope:** per-skill enable/disable toggle (global, context-level), persisted;
  and **actually injecting** the enabled skills into the prompt so the toggle has a
  real end-to-end effect.
- **Out of scope:** agents/sub-agents — they stay exactly as today (activated only
  by a leading `@mention`; when mentioned, their skills always merge in).
- **Out of scope:** per-session skill selection (selection is global on the
  singleton context).

## Decisions (from brainstorming)

- Selection state lives **globally on the context** (singleton), not per session.
- Enabled skills are **rendered into the system instruction** as an
  `# Active Skills` block. Disabled skills are excluded from both the prompt and
  the assembled metadata.
- Skills become structured objects `{ name, enabled }` (same shape philosophy as
  `Tool`), rather than a parallel disabled-list.

## Design

### A. Data model

- **Migration `012_skill_enabled.sql`** (append-only):
  `ALTER TABLE context_skills ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;`
  Existing skills remain enabled — no behavior regression for the toggle state.
- New type `interface Skill { name: string; enabled: boolean }` (backend
  `context.types.ts` and the mirrored frontend types).
- `AetherContext.skills`: `string[]` → `Skill[]`.

### B. Backend — store + prompt injection

**`ContextStore`** (`server/domain/context/context.store.ts`):
- `read` / `writeAll`: read & persist `enabled` (default `1`) for each
  `context_skills` row.
- `addSkill(name)`: creates with `enabled: true`.
- `updateSkillAt(index, name)`: unchanged (renames only).
- **new** `setSkillEnabledAt(index, enabled)`: updates the flag; throws
  `NotFoundError` for an out-of-range index (matches existing methods).
- `removeSkillAt(index)`: unchanged.

**`prompt-assembler.ts`** (`assemble()`):
- Compute active context skill names: `ctx.skills.filter(s => s.enabled).map(s => s.name)`.
- When a sub-agent is mentioned, merge its (always-on) `skills` with the active
  context names, deduped — same dedup as today, just sourced from the enabled set.
- If the resulting active list is non-empty, append a block to `systemInstruction`:
  ```
  # Active Skills
  - <name>
  - <name>
  ```
- `AssembledPrompt.skills` now carries the **active** names only (metadata/trace).
- No block and no metadata entries when zero skills are active.

This is the change that makes skills actually reach the model. Sub-agents are
otherwise untouched.

### C. API

`server/routes/context.routes.ts` + `src/lib/api/context.api.ts`:
- **New** `PATCH /api/context/skills/:index` with body `{ enabled: boolean }` →
  `setSkillEnabledAt`. Explicit and idempotent (good for optimistic UI). Validates
  the body; out-of-range index surfaces the store's `NotFoundError`.
- `POST /skills`, `PUT /skills/:index` (rename), `DELETE /skills/:index`:
  unchanged. The context GET response now includes `enabled` per skill.

### D. Frontend — toggle UX

`src/components/sidebar/SkillsSection.tsx` + `src/stores/context.store.ts`:
- Each skill row becomes **clickable**: row click → toggle enabled (optimistic
  update + `PATCH`, rollback on error — the store's existing pattern).
- Visual states:
  - **Enabled:** current look (text `zinc-400`, accent dot/fill on the left).
  - **Disabled:** dimmed (`zinc-600` / reduced opacity + `line-through`) to read as
    "not in context".
- The **✎ edit** and **× remove** buttons stay on hover and call `stopPropagation`
  so they don't trigger the toggle.
- Header counter: `[{total}]` → `[{active}/{total}]`.
- New store method `toggleSkillAt(index)` (optimistic, rollback on error).

## Testing (TDD)

- **Migration:** applies; existing rows default to `enabled = 1`.
- **ContextStore:** `setSkillEnabledAt` persists; `addSkill` defaults to enabled;
  out-of-range index throws.
- **`assemble()`:** active-only `# Active Skills` block; disabled excluded; no block
  when zero active; merge with a mentioned sub-agent's skills.
- **Route:** `PATCH /skills/:index` validates body and updates; bad index errors.
- **SkillsSection:** row click toggles (optimistic); edit/remove don't trigger the
  toggle; disabled rows render dimmed.
- **context.store:** `toggleSkillAt` optimistic update + rollback on API error.

## Risks / notes

- Changing `AetherContext.skills` from `string[]` to `Skill[]` ripples through the
  context store, routes, assembler, frontend store/section and their tests. The
  change is mechanical but broad; tests guard each layer.
- Because skills now reach the model for the first time, expect a (desirable)
  behavior change: prompts include an `# Active Skills` block when any skill is
  enabled.
