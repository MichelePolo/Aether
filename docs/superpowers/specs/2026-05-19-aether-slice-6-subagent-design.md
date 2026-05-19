# Aether — Slice 6: Sub-agent Dispatch (Design)

**Branch:** `feat/slice-6-subagent`
**Date:** 2026-05-19
**Depends on:** slices 0–5.

## Goal

Add named sub-agents — light personas with their own system-instruction overlay, skills, and tools. They are stored server-side, surfaced in the sidebar, invoked from chat with `@name`, and traced in the reasoning timeline. The leading `@<name>` token is stripped before the message reaches the model; the original message is preserved in chat history.

## Non-goals

- MCP servers on sub-agents (out of scope; will be unified in slice 7).
- Multi-mention composition (`@a @b`). Single leading mention only.
- Mid-message `@mentions`. Only `^@name\s+`.
- Per-session sub-agents. Single global registry.
- Sub-agent system-instruction templating / variable interpolation. Plain string.
- Import/export of sub-agents (deferred; profiles already cover the export needs).
- Sub-agent inheritance / nesting.

## Decisions log

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Sub-agent shape | `{ id, name, systemInstruction, skills, tools }` — own skills + tools, no MCP | Expressive enough to be useful; MCP belongs to slice 7 |
| 2 | Storage | New `/api/subagents` CRUD + `data/subagents.json` (JsonStore) | Matches profiles / context pattern; isolated test surface |
| 3 | Trigger syntax | Leading `^@name\s+`, single per turn | Deterministic parsing, simple UX |
| 4 | Overlay strategy | Append `systemInstruction`, union (dedup) skills/tools | Sub-agent extends base; preserves global protocol |
| 5 | `@name` token in message | Stripped before model; preserved in chat history | Cleaner model input; user-visible message unchanged |
| 6 | Autocomplete UI | Inline floating dropdown above textarea | Discord/Slack convention; inline action stays inline |
| 7 | Unknown `@name` | Treat as normal text (no error, no strip) | Forgiving; doesn't break `@username` writing |
| 8 | Reasoning trace | New `resolve_subagent` step type + `subAgent` field on dispatch | Marks the persona-resolution moment in the trace |
| 9 | Management UI | New `SubAgentsSection` in sidebar (alongside Skills/Tools/MCP) | Discoverable; matches existing aesthetic |
| 10 | Name format | `^[A-Za-z][A-Za-z0-9_-]*$`, max 64 chars | Valid `@mention` slug; eliminates parser ambiguity |
| 11 | Name collisions on create | Server-side suffixing `(N)` like profiles | Idempotent under retries |
| 12 | Slice-6 UI scope for sub-agent fields | Sidebar exposes Add/Edit for `name` + `systemInstruction` only; `skills`/`tools` default to `[]` | Keeps slice small; data model already supports them; future slice can expose editing |

## Architecture

### Backend (`server/`)

| Path | Role |
|---|---|
| `domain/subagents/subagents.types.ts` | `SubAgentRecord`, `SubAgentMeta`, `SubAgentsFile` |
| `domain/subagents/subagents.schema.ts` | zod schemas (`SubAgentNameSchema`, `SubAgentRecordSchema`, `SubAgentsFileSchema`) |
| `domain/subagents/subagents.schema.test.ts` | Schema unit tests |
| `domain/subagents/subagents.store.ts` | `JsonStore`-backed CRUD + name-collision suffix |
| `domain/subagents/subagents.store.test.ts` | Store unit tests |
| `domain/dispatch/subagent-parser.ts` | Pure: `parseLeadingMention(message, knownNames) → { name, stripped }` |
| `domain/dispatch/subagent-parser.test.ts` | Parser unit tests |
| `domain/dispatch/prompt-assembler.ts` | Pure: `assemble(ctx, subAgent?, message, resolvedName) → AssembledPrompt` |
| `domain/dispatch/prompt-assembler.test.ts` | Assembler unit tests |
| `domain/dispatch/dispatch.service.ts` | **Modify**: fetch sub-agents, parse, assemble, emit `resolve_subagent` step, tag dispatch with `subAgent` |
| `domain/reasoning/reasoning.types.ts` | **Modify**: add `'resolve_subagent'` to `ReasoningStepType` |
| `domain/reasoning/reasoning.schema.ts` | **Modify**: extend the union accordingly |
| `routes/subagents.routes.ts` | 5 endpoints (`GET /`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id`) |
| `routes/subagents.routes.test.ts` | Supertest integration |
| `app.ts` | **Modify**: `AppDeps` gains optional `subAgentsStore`; mount block |
| `index.ts` | **Modify**: instantiate `SubAgentsStore` (path `data/subagents.json`) |

### Frontend (`src/`)

| Path | Role |
|---|---|
| `types/subagent.types.ts` | Re-export `SubAgentRecord`, `SubAgentMeta` from server types |
| `lib/api/subagents.api.ts` | REST client (`list/get/create/update/delete`) |
| `lib/api/subagents.api.test.ts` | MSW-backed client unit tests |
| `stores/subagents.store.ts` | Zustand store (`init/create/update/delete`, `error`) |
| `stores/subagents.store.test.ts` | Store unit tests |
| `test/msw-handlers.ts` | **Modify**: default handlers for `/api/subagents*` |
| `hooks/useMentionAutocomplete.ts` | Pure caret-state parser: `compute(text, caretPos, names) → { open, query, anchorRange }` |
| `hooks/useMentionAutocomplete.test.ts` | Unit tests for caret-state parser |
| `components/chat/MentionPopover.tsx` | Floating dropdown over textarea (icon + name + truncated systemInstruction preview) |
| `components/chat/MentionPopover.test.tsx` | Component tests |
| `components/chat/MessageInput.tsx` | **Modify**: integrate mention state + popover |
| `components/chat/MessageInput.test.tsx` | **Modify**: append autocomplete tests |
| `components/sidebar/SubAgentsSection.tsx` | Sidebar list + Add/Edit/Delete via dialog flow |
| `components/sidebar/SubAgentsSection.test.tsx` | Component tests |
| `components/reasoning/ReasoningStepCard.tsx` | **Modify**: render `subAgent` badge + handle `resolve_subagent` step type |
| `components/reasoning/ReasoningStepCard.test.tsx` | **Modify**: badge + new type tests |
| `App.tsx` | **Modify**: init `useSubAgentsStore`, mount `<SubAgentsSection />` |
| `App.test.tsx` | **Modify**: reset `useSubAgentsStore` in `beforeEach` |
| `integration/subagent.integration.test.tsx` | App-level: create sub-agent, mention it, assert dispatch + reasoning trace |

### E2E

`e2e/smoke.spec.ts` gains one test: create sub-agent in sidebar → send `@name ping` → reply → open ReasoningDrawer → assert `Sub-agent: <name>` badge. Local Playwright runs blocked by port 3000 (Docker) — write only.

## Types

```ts
// server/domain/subagents/subagents.types.ts
import type { Tool } from '@/server/domain/context/context.types';

export interface SubAgentRecord {
  name: string;
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  createdAt: number;
  updatedAt: number;
}

export interface SubAgentMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type SubAgentsFile = Record<string, SubAgentRecord>;
```

```ts
// server/domain/subagents/subagents.schema.ts
import { z } from 'zod';
import { ToolSchema } from '@/server/domain/context/context.schema';

export const SubAgentNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

export const SubAgentRecordSchema = z.object({
  name: SubAgentNameSchema,
  systemInstruction: z.string().max(8000),
  skills: z.array(z.string()).max(50),
  tools: z.array(ToolSchema).max(50),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const SubAgentsFileSchema = z.record(z.string(), SubAgentRecordSchema);

export const SubAgentCreateInputSchema = z.object({
  name: SubAgentNameSchema,
  systemInstruction: z.string().max(8000).default(''),
  skills: z.array(z.string()).max(50).default([]),
  tools: z.array(ToolSchema).max(50).default([]),
});

export const SubAgentUpdateInputSchema = SubAgentCreateInputSchema.partial();
```

The `Tool` zod schema (slice 1) is reused without modification.

## Parser

```ts
// server/domain/dispatch/subagent-parser.ts
const LEADING_MENTION = /^@([A-Za-z][A-Za-z0-9_-]*)(\s+|$)/;

export interface ParsedMention {
  name: string | null;
  stripped: string;
}

export function parseLeadingMention(
  message: string,
  knownNames: ReadonlySet<string>,
): ParsedMention {
  const m = LEADING_MENTION.exec(message);
  if (!m) return { name: null, stripped: message };
  const name = m[1];
  if (!knownNames.has(name)) return { name: null, stripped: message };
  return { name, stripped: message.slice(m[0].length) };
}
```

The regex anchors at `^` and consumes trailing whitespace (or EOL for the `@name`-only case). Unknown names are treated as normal text: `name: null`, message kept intact.

## Assembler

```ts
// server/domain/dispatch/prompt-assembler.ts
import type { AetherContext, Tool } from '@/server/domain/context/context.types';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';

export interface AssembledPrompt {
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  message: string;
  subAgent: string | null;
}

export function assemble(
  ctx: AetherContext,
  subAgent: SubAgentRecord | null,
  parsedMessage: string,
  resolvedName: string | null,
): AssembledPrompt {
  if (!subAgent) {
    return {
      systemInstruction: ctx.systemInstruction,
      skills: ctx.skills,
      tools: ctx.tools,
      message: parsedMessage,
      subAgent: null,
    };
  }
  const sys = [
    ctx.systemInstruction.trim(),
    `# Sub-agent: ${subAgent.name}`,
    subAgent.systemInstruction.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  const skills = dedupStrings([...ctx.skills, ...subAgent.skills]);
  const tools = dedupToolsById([...ctx.tools, ...subAgent.tools]);
  return { systemInstruction: sys, skills, tools, message: parsedMessage, subAgent: resolvedName };
}

function dedupStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function dedupToolsById(arr: Tool[]): Tool[] {
  const seen = new Set<string>();
  const out: Tool[] = [];
  for (const t of arr) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}
```

Dedup rules:
- Skills: keep first occurrence of each string (case-sensitive). Context skills win.
- Tools: keep first occurrence by `id`. Context tools win over sub-agent tools with the same id.

## Dispatch service flow

Modifications to `server/domain/dispatch/dispatch.service.ts`:

1. Extend the existing `context_fetch` step to also load sub-agent names. The combined step's content becomes `"loaded systemInstruction (N chars), K sub-agents"`.
2. `const knownNames = new Set(subAgents.map(s => s.name))`.
3. `const parsed = parseLeadingMention(message, knownNames)`.
4. If `parsed.name`:
   - Resolve the matching `SubAgentRecord` (in-memory from the list result; no extra round trip).
   - `await tracer.step({ type: 'resolve_subagent', title: 'Sub-agent: ' + name, run: async () => ({ content: 'systemInstruction +X chars, +S skills, +T tools', result: null, subAgent: name }) })`.
5. `const assembled = assemble(ctx, matchedSubAgent ?? null, parsed.stripped, parsed.name)`.
6. `historyStore.append(sessionId, { role: 'user', text: message, ... })` — saves the **original** message (unchanged).
7. Dispatch step: provider receives `{ systemInstruction: assembled.systemInstruction, userMessage: assembled.message, ... }`. The tracer step itself carries `subAgent: assembled.subAgent` (nullable).
8. Validation step and final history-append are unchanged. The model assistant message includes `reasoningSteps` (which now contains `resolve_subagent` when applicable).

`AppDeps` extension:

```ts
export interface AppDeps {
  // ... existing
  subAgentsStore?: SubAgentsStore;
}
```

Dispatch service gains `subAgentsStore` in its `DispatchServiceDeps`. When `subAgentsStore` is undefined (legacy / tests that don't wire it), the parser receives an empty `knownNames` set and effectively no-ops — backwards compatible.

## Tracer extension

`ReasoningStep.type` already has `subAgent?: string`. Adding `'resolve_subagent'` to `ReasoningStepType` is the only change in `reasoning.types.ts` + `reasoning.schema.ts`. The `tracer.step` API stays the same; `run` callbacks can now return `{ content, result, subAgent? }`.

## Routes

```
GET    /api/subagents          → { subAgents: SubAgentMeta[] }
POST   /api/subagents          → 201 SubAgentMeta (server-suffixes name on collision)
GET    /api/subagents/:id      → SubAgentRecord & { id }
PUT    /api/subagents/:id      → SubAgentRecord & { id }
DELETE /api/subagents/:id      → 204
```

400 on zod failure, 404 on unknown id, 500 on store IO. No bulk endpoints.

## Frontend autocomplete

`useMentionAutocomplete(text, caretPos, names) → { open: boolean, query: string, replaceRange: [start, end] }`:

- `open: true` only when there's a `@token` directly to the left of the caret, anchored at start-of-string OR after whitespace.
- `query` is the substring after `@` and before the caret.
- `replaceRange` covers `@<query>` so that selecting an item replaces with `@<name> `.
- Closes when: caret moves past whitespace, the `@` is deleted, or `Esc` pressed.

```ts
// src/hooks/useMentionAutocomplete.ts
export interface MentionState {
  open: boolean;
  query: string;
  replaceRange: [number, number];
}

export function computeMentionState(
  text: string,
  caret: number,
  names: ReadonlyArray<string>,
): MentionState;
```

Implementation: walk backwards from caret to find `@` boundary, or hit whitespace. Open only if a `@` is found and what's between is `^[A-Za-z0-9_-]*$`. Full implementation pseudocode in plan.

`MentionPopover` is a controlled list:

```tsx
<MentionPopover
  open={state.open}
  query={state.query}
  items={subAgents}
  onSelect={(name) => insert(name)}
  onClose={() => closeMention()}
  anchorRef={textareaRef}
/>
```

Keyboard: ↑/↓ move highlight; Enter / Tab select; Esc closes (and the caret moves on).

## Error handling

| Source | Behaviour |
|---|---|
| Backend store IO fail when listing sub-agents | Dispatch logs a warning and proceeds with empty `knownNames`. Parser no-ops; user message is treated normally. |
| Sub-agent renamed/deleted after FE list cache | The dispatch always re-fetches before parsing, so stale FE cache cannot cause divergent assembly. |
| Name collision on POST/PUT | Server suffixes `(N)` and returns the actual name. FE store reconciles by re-reading the entity from the response. |
| Zod validation fails on POST/PUT | 400 `{ error: { message, path } }`. FE store sets `error` field. |
| `useSubAgentsStore.create` throws | Sidebar section shows red error pill with dismiss × (same pattern as `ProfilesModal`). |
| MentionPopover with empty list | Shows "No sub-agents yet" placeholder. Enter/Tab is a no-op. Esc closes. |
| Sub-agent system instruction > 8000 chars on update | Server returns 400; FE shows error pill. PromptDialog (now multiline) is used for editing. |

## Persistence

- `data/subagents.json` — `Record<id, SubAgentRecord>`, file format identical pattern to profiles. JsonStore guarantees atomic write (slice 0).
- No localStorage entries. There is no client-side "active sub-agent" concept — a sub-agent is per-turn invocation, not state.

## Testing

### Backend unit (Vitest)

- `subagent-parser.test.ts` — leading match, no leading, unknown name, edge whitespace, multi-char name with `_`/`-`, name starting with digit (rejected), `@` only, empty message, 64-char boundary, name at exactly 64 chars.
- `prompt-assembler.test.ts` — null subAgent passthrough, system-instruction concat format, dedup skills (context wins), dedup tools by id (context wins), tools with same name but different id both kept, empty arrays in either side.
- `subagents.schema.test.ts` — invalid slugs (spaces, leading digit, leading dash, special chars), success path, max-length boundary on `systemInstruction`, max-length boundary on `name`.
- `subagents.store.test.ts` — list (empty + populated), create + read-back, name collision suffix `(2)`/`(3)`, update changes both `updatedAt` and value, delete removes, persistence across re-instantiation (re-create store on same file).

### Backend integration (supertest)

- `subagents.routes.test.ts` — 8 cases: list empty, create OK, create with collision returns 201 with suffixed name, get by id, get 404, update name + bump `updatedAt`, update validation error → 400, delete 204 + subsequent get 404.
- `dispatch.routes.test.ts` (extend) — POST with `@designer make X`: assert SSE stream contains a `step` event of type `resolve_subagent` with `subAgent: 'designer'`, then a `step` event of type `dispatch` also with `subAgent: 'designer'`. FakeProvider stub captures the `systemInstruction` passed in: assert it contains `# Sub-agent: designer`. The persisted history entry contains the **original** message (`@designer make X`).
- `dispatch.routes.test.ts` — POST with `@unknown make X`: no `resolve_subagent` step; FakeProvider received `userMessage: '@unknown make X'` (unstripped); dispatch step `subAgent` is `null`/undefined.

### Frontend unit (Vitest + MSW)

- `subagents.api.test.ts` — round-trip each of the 5 endpoints.
- `subagents.store.test.ts` — init/create/update/delete + error states + reset on `_reset()`.
- `useMentionAutocomplete.test.ts` — `compute('', 0, [...])` → closed; `compute('@', 1, [...])` → open with empty query; `compute('@des', 4, [...])` → open with `'des'`; `compute('hello @des', 10, [...])` → open with `'des'` (whitespace-anchored); `compute('mail @user@domain', 17, [...])` → closed (the `@` follows a non-whitespace char); `compute('@designer ', 10, [...])` → closed (space after name).

### Frontend component (RTL + user-event)

- `MentionPopover.test.tsx` — renders list, filters by query, ↑↓ updates `data-selected` index, Enter calls `onSelect(highlightedName)`, Esc calls `onClose`, empty items shows placeholder.
- `MessageInput.test.tsx` (extend) — type `@d` → popover appears with sub-agents starting with `d`, ↓ + Enter inserts `@designer ` and closes popover, plain submit (no popover open) calls `onSend` with full text.
- `SubAgentsSection.test.tsx` — empty state + populated list, "+ New sub-agent" opens prompt chain (name → system instruction multiline), edit / delete actions, error pill render + dismiss.
- `ReasoningStepCard.test.tsx` (extend) — type `resolve_subagent` renders title + sub-agent badge, type `dispatch` with `subAgent` renders the badge too.

### Integration (RTL + MSW, App-level)

`subagent.integration.test.tsx` — mount `<App />`, MSW returns a sub-agent named `designer` from `GET /api/subagents`. User types `@designer make X` in MessageInput → submit → MSW intercepts `POST /api/dispatch`. The test stubs the dispatch endpoint to capture the request body and asserts the request body sent to the server is `{ sessionId, message: '@designer make X', thinking?: false }`. Server-side assembly happens on the backend; the frontend's job is to send the original message. The mocked SSE stream replies with a `step:resolve_subagent` event and a `step:dispatch` event with `subAgent: 'designer'`. Assert the ReasoningDrawer renders the badge.

### E2E (Playwright)

Append to `e2e/smoke.spec.ts`: `subagent: create + invoke + badge`:
1. wipe sub-agents (DELETE all from `/api/subagents`).
2. create one via sidebar's `SubAgentsSection` (`+ New sub-agent` → "designer" → multiline system instruction "you are a designer").
3. type `@designer ping` in MessageInput, Enter.
4. wait for `pong` reply.
5. open ReasoningDrawer; assert `Sub-agent: designer` badge visible.

Local Playwright not run (port 3000 Docker conflict). Test committed for CI.

### Coverage target

≥80% lines on: `subagent-parser.ts`, `prompt-assembler.ts`, `subagents.store.ts`, `subagents.routes.ts`, `useMentionAutocomplete.ts`, `MentionPopover.tsx`, `src/stores/subagents.store.ts`, `src/lib/api/subagents.api.ts`.

## Risks

| Risk | Mitigation |
|---|---|
| Mention parser false-positives breaking existing chats with `@`-style writing | The leading-only anchor (`^@`) is conservative. Real-world `@user`-mid-sentence is unaffected. |
| Dispatch service refactor breaks slice 2a/2b tests | Sub-agents are wired through `subAgentsStore?` (optional) in `DispatchServiceDeps`. When absent, parser receives empty set and no-ops. All slice 2 tests should keep passing untouched. |
| `MentionPopover` over-fires on `@` in pasted text | Caret-based detection: popover only opens when the caret is immediately right of `@token`. Paste lands the caret past the end; if the paste ends in `@name`, that's the same trigger as typing — acceptable. |
| Multiline system instructions break import/export | Out of scope (Decisions row: import/export deferred). |
| Slug collision with profile names | Different namespaces, different files. Zero overlap. |
| `tools` field on sub-agent diverges from context's `Tool` shape | Both reuse the same `ToolSchema` and `Tool` interface from slice 1 — no duplication. |

## Definition of Done

- All new BE + FE unit / component / integration tests green.
- `e2e/smoke.spec.ts` has 9 tests; new one written (run blocked locally by port 3000).
- `npm run lint` clean.
- Coverage ≥80% on the new files listed above.
- Manual smoke via `npm run dev`: create sub-agent in sidebar, send `@<name> hello` in chat, see `Sub-agent: <name>` badge in ReasoningDrawer, reply received normally.
- One PR on `feat/slice-6-subagent` against `main`.
