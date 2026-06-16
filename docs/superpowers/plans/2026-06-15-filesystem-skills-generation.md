# Filesystem Skills — AI-Assisted Generation (Plan 2 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "Create Skill with AI" flow on top of the Plan 1 foundation: a dedicated chat session, with a user-chosen model, where a seeded `skill-smith` subagent guides the user through brainstorming and then generates a new skill directory into `${AETHER_DATA_DIR}/skills/.drafts/<slug>/` (reviewable + promotable via the Plan 1 UI).

**Architecture (decided in brainstorming):** Reuse, don't refactor. The generation session is just a normal Aether session with a chosen provider where the user `@skill-smith` mentions a seeded subagent. The subagent's **static** system instruction owns the *process* (brainstorm → read the `brainstorming` + `skill-creator` SKILL.md files from the skills dir → generate → write to `.drafts/<slug>/`). The **composer prefill** injects the *actual* absolute skills-dir path. The model reads the two guide skills and writes the draft via the existing built-in **filesystem MCP** (write supported); tool calls are gated normally (the user is present and approves). No changes to `DispatchService`, the MCP registry, or breakpoint gating.

**Tech Stack:** TypeScript (strict), Express, better-sqlite3, React 19 + Zustand, Vitest. No new dependencies.

**Builds on Plan 1 (already merged on this branch):** `SkillsService` (skills dir + `.drafts/`, discovery, promote), the `skills.store`/`skills.api`, the unified `SkillsSection`, the bundled `brainstorming` + `skill-creator` default skills, and the fs-MCP-off warning.

---

## Why this is small

The exploration confirmed everything the flow needs already exists:
- **Per-session provider** — `sessions` store `providerName`; `sessionsApi.setProviderName`. ✅
- **`@mention` autocomplete + resolution** — `useMentionAutocomplete` + `MentionPopover` + dispatch's `parseLeadingMention`; works the moment a subagent named `skill-smith` exists. ✅
- **Subagent mechanism** — a subagent carries its own `systemInstruction`; dispatch prepends it. ✅
- **Filesystem read+write** — built-in filesystem MCP (`@modelcontextprotocol/server-filesystem`) supports writes; Plan 1 already warns when it's off. ✅
- **Drafts review/promote** — Plan 1's `SkillsSection` already renders `.drafts/` with Review&promote. ✅

So Plan 2 only adds: (1) a seeded `skill-smith` subagent, (2) the skills-dir path exposed to the frontend, (3) a one-shot composer prefill, (4) a "Create Skill with AI" modal + button.

---

## File structure (Plan 2)

**Backend:**
- Create `server/domain/subagents/skill-smith.ts` — the `SKILL_SMITH_NAME` constant + `SKILL_SMITH_INSTRUCTION` text + `seedSkillSmith(store)`.
- Create `server/domain/subagents/skill-smith.test.ts`.
- Modify `server/index.ts` — call `seedSkillSmith(subAgentsStore)` in bootstrap.
- Modify `server/domain/skills/skills.types.ts` — add `paths` to `SkillsList`.
- Modify `server/domain/skills/skills.service.ts` — return `paths: { skillsDir, draftsDir }` from `list()`.
- Modify `server/domain/skills/skills.service.test.ts` — assert the new `paths`.

**Frontend:**
- Modify `src/stores/chat.store.ts` — add one-shot `pendingComposerText` + `setPendingComposerText`.
- Modify `src/components/chat/MessageInput.tsx` — consume `pendingComposerText` once (set value + focus + clear).
- Create `src/lib/skills/createSkillFlow.ts` — pure orchestration: create session → set provider → prefill composer.
- Create `src/components/skills/CreateSkillModal.tsx` — provider select + optional idea + Start.
- Modify `src/stores/ui.store.ts` — add a `creatingSkill` open/close flag (mirror `editingSubAgentId`).
- Modify `src/components/sidebar/SkillsSection.tsx` — add the "Create with AI" button.
- Mount `CreateSkillModal` where other modals mount (e.g. alongside `SubAgentEditModal`/`DialogHost`).
- Modify `src/i18n/en.ts` — strings for the modal.

---

## Phase A — Backend: seed the `skill-smith` subagent

### Task 1: `skill-smith` constant, instruction, and idempotent seed

**Files:**
- Create: `server/domain/subagents/skill-smith.ts`
- Test: `server/domain/subagents/skill-smith.test.ts`

**Context:** `SubAgentsStore` (`server/domain/subagents/subagents.store.ts`) has `list(): Promise<SubAgentMeta[]>` and `create(input): Promise<SubAgentMeta>`. READ the store first to confirm the exact `create` input shape (it accepts `name`, `systemInstruction`, `skills: string[]`, `tools: Tool[]`). Names must match `^[A-Za-z][A-Za-z0-9_-]*$`. There is NO uniqueness DB constraint — the store auto-suffixes `(2)` on collision — so the seed MUST check existence by name and skip creation if present (this preserves user edits and avoids duplicates on every boot).

- [ ] **Step 1: Write the failing test** `server/domain/subagents/skill-smith.test.ts`

```ts
import { SubAgentsStore } from './subagents.store';
import { seedSkillSmith, SKILL_SMITH_NAME } from './skill-smith';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: SubAgentsStore;

beforeEach(() => {
  db = makeTestDb();
  store = new SubAgentsStore(db);
});
afterEach(() => db.close());

describe('seedSkillSmith', () => {
  it('creates the skill-smith subagent when none exists', async () => {
    await seedSkillSmith(store);
    const all = await store.list();
    expect(all.map((s) => s.name)).toContain(SKILL_SMITH_NAME);
  });

  it('writes a non-empty system instruction mentioning the drafts workflow', async () => {
    await seedSkillSmith(store);
    const meta = (await store.list()).find((s) => s.name === SKILL_SMITH_NAME)!;
    const rec = await store.read(meta.id);
    expect(rec?.systemInstruction.length ?? 0).toBeGreaterThan(50);
    expect(rec?.systemInstruction).toMatch(/\.drafts/);
  });

  it('is idempotent — a second call does not create a duplicate', async () => {
    await seedSkillSmith(store);
    await seedSkillSmith(store);
    const count = (await store.list()).filter((s) => s.name === SKILL_SMITH_NAME).length;
    expect(count).toBe(1);
  });

  it('does not overwrite a user-edited skill-smith', async () => {
    await seedSkillSmith(store);
    const meta = (await store.list()).find((s) => s.name === SKILL_SMITH_NAME)!;
    await store.update(meta.id, { systemInstruction: 'USER EDIT' });
    await seedSkillSmith(store);
    const rec = await store.read(meta.id);
    expect(rec?.systemInstruction).toBe('USER EDIT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/subagents/skill-smith.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `server/domain/subagents/skill-smith.ts`

```ts
import type { SubAgentsStore } from './subagents.store';

export const SKILL_SMITH_NAME = 'skill-smith';

/**
 * Static process instruction for the skill-generation subagent. Intentionally
 * path-agnostic: the absolute skills directory is injected at runtime via the
 * composer prefill (see the frontend create-skill flow). The two guide skills
 * (brainstorming, skill-creator) are the bundled defaults Plan 1 seeds into the
 * skills dir; this subagent tells the model to read their SKILL.md files.
 */
export const SKILL_SMITH_INSTRUCTION = `You are skill-smith, an assistant that creates new Aether skills with the user.

A skill is a self-contained directory whose entry point is a SKILL.md file with YAML frontmatter (\`name\` — which must equal the directory name — and \`description\`, a one-line statement of WHEN to use the skill), followed by focused instructions. It may include referenced resources.

Follow this process:

1. Brainstorm first. Before writing anything, read the full \`brainstorming\` skill (its SKILL.md lives in the skills directory) and follow it: ask the user ONE question at a time to pin down the skill's purpose, when it should trigger, and what it must contain. Do not skip this dialogue.

2. Generate with skill-creator. Once the design is agreed, read the \`skill-creator\` skill (its SKILL.md is in the skills directory) and follow its method to produce the files. Choose a short kebab-case slug; the SKILL.md \`name\` MUST equal that slug.

3. Write to drafts only. Create the new skill under the \`.drafts/<slug>/\` folder inside the skills directory (the user's message will give you the absolute skills-directory path). Never write outside \`.drafts/\`. Use your filesystem tools.

4. Hand off. When the files are written, tell the user the draft is ready and that they can review and promote it from the Skills panel. Do not try to enable or promote it yourself.

Keep the SKILL.md tight; push depth into referenced files. Confirm the slug with the user before writing.`;

/**
 * Idempotently ensure the default skill-smith subagent exists. Skips creation
 * if a subagent of that name is already present (preserving user edits).
 */
export async function seedSkillSmith(store: SubAgentsStore): Promise<void> {
  const existing = await store.list();
  if (existing.some((s) => s.name === SKILL_SMITH_NAME)) return;
  await store.create({
    name: SKILL_SMITH_NAME,
    systemInstruction: SKILL_SMITH_INSTRUCTION,
    skills: [],
    tools: [],
  });
}
```

> NOTE: confirm `store.create` accepts exactly `{ name, systemInstruction, skills, tools }`. If the real `CreateInput` differs (e.g. requires/omits a field), adapt the call to the real shape and report it. `skills: []` is intentional — the guide skills are read from disk, not injected as bare label names.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/subagents/skill-smith.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/subagents/skill-smith.ts server/domain/subagents/skill-smith.test.ts
git commit -m "feat(skills): skill-smith subagent definition + idempotent seed"
```

---

### Task 2: Wire `seedSkillSmith` into bootstrap

**Files:**
- Modify: `server/index.ts`

**Context:** `seedDefaultSkills(...)` is already called in `bootstrap()`, and `subAgentsStore` is constructed there (`new SubAgentsStore(db)`). `seedSkillSmith` is async; bootstrap is async.

- [ ] **Step 1: Add the import**

```ts
import { seedSkillSmith } from './domain/subagents/skill-smith';
```
(Match the existing relative-import style for domain modules in this file.)

- [ ] **Step 2: Call the seed after `subAgentsStore` is constructed**

Find `const subAgentsStore = new SubAgentsStore(db);` and immediately after it add:
```ts
await seedSkillSmith(subAgentsStore);
```
(It must be `await`ed; `bootstrap()` is async. Place it after construction and before `createApp`.)

- [ ] **Step 3: Smoke-boot and confirm the subagent is seeded**

Run:
```bash
D=$(mktemp -d); AETHER_FAKE_PROVIDER=1 AETHER_DATA_DIR="$D" PORT=3998 npx tsx server/index.ts >/tmp/p2boot.log 2>&1 &
SRV=$!; for i in $(seq 1 30); do curl -sf http://localhost:3998/api/subagents >/dev/null 2>&1 && break; sleep 0.5; done
curl -s http://localhost:3998/api/subagents | python3 -c "import sys,json; print([s['name'] for s in json.load(sys.stdin)['subAgents']])"
kill $SRV 2>/dev/null; rm -rf "$D"
```
Expected: the printed list contains `skill-smith`.

- [ ] **Step 4: Lint + commit**

Run: `npm run lint` → PASS.
```bash
git add server/index.ts
git commit -m "feat(skills): seed skill-smith subagent on boot"
```

---

## Phase B — Backend: expose the skills-dir path

### Task 3: Add `paths` to `SkillsService.list()`

**Files:**
- Modify: `server/domain/skills/skills.types.ts`
- Modify: `server/domain/skills/skills.service.ts`
- Modify: `server/domain/skills/skills.service.test.ts`

**Context:** The frontend create-skill flow needs the absolute skills dir + drafts dir to prefill the composer with a real path. `SkillsService` already computes `this.skillsDir`; `draftsDirFor(dataDir)` exists in `skills.paths.ts`. Extend the existing `GET /api/skills` payload (no new route).

- [ ] **Step 1: Extend the test** — add to `server/domain/skills/skills.service.test.ts`, inside `describe('SkillsService.list', ...)`:

```ts
  it('returns absolute skills and drafts paths', () => {
    const { paths } = service.list();
    expect(paths.skillsDir).toBe(path.join(dataDir, 'skills'));
    expect(paths.draftsDir).toBe(path.join(dataDir, 'skills', '.drafts'));
  });
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `npx vitest run server/domain/skills/skills.service.test.ts`
Expected: FAIL — `paths` is undefined.

- [ ] **Step 3: Extend the type** in `server/domain/skills/skills.types.ts`:

```ts
export interface SkillsList {
  skills: MaterialSkill[];
  drafts: DraftSkill[];
  paths: { skillsDir: string; draftsDir: string };
}
```

- [ ] **Step 4: Populate it** in `server/domain/skills/skills.service.ts`. Add the import:
```ts
import { skillsDirFor, draftsDirFor } from './skills.paths';
```
(`skillsDirFor` is already imported — just add `draftsDirFor`.) Then store the dataDir and return paths from `list()`. Change the constructor to keep `dataDir`:
```ts
  private readonly skillsDir: string;
  private readonly draftsDir: string;

  constructor(
    private readonly state: SkillStateStore,
    dataDir: string,
  ) {
    this.skillsDir = skillsDirFor(dataDir);
    this.draftsDir = draftsDirFor(dataDir);
  }
```
And at the end of `list()`, include paths:
```ts
    return { skills, drafts, paths: { skillsDir: this.skillsDir, draftsDir: this.draftsDir } };
```

- [ ] **Step 5: Run tests, confirm PASS**

Run: `npx vitest run server/domain/skills/skills.service.test.ts`
Expected: PASS (existing + the new path test).

- [ ] **Step 6: Lint + commit**

Run: `npm run lint` → PASS.
```bash
git add server/domain/skills/skills.types.ts server/domain/skills/skills.service.ts server/domain/skills/skills.service.test.ts
git commit -m "feat(skills): expose skills/drafts absolute paths in list payload"
```

---

## Phase C — Frontend: one-shot composer prefill

### Task 4: `pendingComposerText` in the chat store

**Files:**
- Modify: `src/stores/chat.store.ts`
- Test: `src/stores/chat.store.test.ts` (append, or create a focused test if absent)

**Context:** READ `src/stores/chat.store.ts` first — find the state interface, the `create(...)` initializer, and the existing `reset()` (the composer prefill must survive or be set after `reset()`; the create-skill flow sets it AFTER creating the session). Add a one-shot field consumed by the composer. Follow the store's existing style (do NOT convert it to something else).

- [ ] **Step 1: Write the failing test** (append to the chat store test, or create `src/stores/chat.store.test.ts`):

```ts
import { useChatStore } from './chat.store';

describe('chat store pendingComposerText', () => {
  it('defaults to null and can be set and cleared', () => {
    expect(useChatStore.getState().pendingComposerText).toBeNull();
    useChatStore.getState().setPendingComposerText('@skill-smith hi');
    expect(useChatStore.getState().pendingComposerText).toBe('@skill-smith hi');
    useChatStore.getState().setPendingComposerText(null);
    expect(useChatStore.getState().pendingComposerText).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `npx vitest run src/stores/chat.store.test.ts`
Expected: FAIL — `pendingComposerText` undefined / `setPendingComposerText` not a function.

- [ ] **Step 3: Implement** — in `src/stores/chat.store.ts`:
  - Add to the state interface: `pendingComposerText: string | null;` and `setPendingComposerText: (text: string | null) => void;`
  - In the store initializer add `pendingComposerText: null,` and `setPendingComposerText: (text) => set({ pendingComposerText: text }),`.
  - Do NOT clear it in `reset()` (the flow sets it after creating/activating the session, and `setActive` calls `reset()`). If `reset()` currently spreads an initial-state object, leave `pendingComposerText` out of what reset overwrites, OR set the flow to prefill after activation (Task 6 sequences it after `create()`). Confirm by reading `reset()` and choosing the correct approach; document which you chose.

- [ ] **Step 4: Run test, confirm PASS**

Run: `npx vitest run src/stores/chat.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` → PASS.
```bash
git add src/stores/chat.store.ts src/stores/chat.store.test.ts
git commit -m "feat(skills): one-shot pendingComposerText in chat store"
```

---

### Task 5: Consume `pendingComposerText` in the composer

**Files:**
- Modify: `src/components/chat/MessageInput.tsx`

**Context:** READ `MessageInput.tsx`. It holds composer text in local state `const [value, setValue] = useState('')` (~line 30) and has `textareaRef` (~line 32). Add a `useEffect` that, when `pendingComposerText` becomes non-null, sets the local value, focuses the textarea (cursor at end), and clears the pending text so it fires once.

- [ ] **Step 1: Add the wiring**

Add near the other store hooks:
```tsx
import { useChatStore } from '@/src/stores/chat.store';
// ...
const pendingComposerText = useChatStore((s) => s.pendingComposerText);
const setPendingComposerText = useChatStore((s) => s.setPendingComposerText);
```
Add an effect (after `value`/`textareaRef` are declared):
```tsx
useEffect(() => {
  if (pendingComposerText === null) return;
  setValue(pendingComposerText);
  setPendingComposerText(null);
  const el = textareaRef.current;
  if (el) {
    el.focus();
    const end = pendingComposerText.length;
    requestAnimationFrame(() => el.setSelectionRange(end, end));
    autoGrow(el);
  }
}, [pendingComposerText, setPendingComposerText]);
```
> NOTE: `autoGrow` is an existing helper in this file — call it if present; if its signature differs, adapt or drop that line. If `useEffect` isn't already imported from React, add it. Do not otherwise change the composer's typing/submit behavior.

- [ ] **Step 2: Lint + verify existing composer tests still pass**

Run: `npm run lint` → PASS.
Run: `npx vitest run src/components/chat` (whatever composer tests exist) → PASS (no regression).

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/MessageInput.tsx
git commit -m "feat(skills): composer consumes one-shot prefill text"
```

---

## Phase D — Frontend: the create-skill flow + modal

### Task 6: The orchestration flow

**Files:**
- Create: `src/lib/skills/createSkillFlow.ts`
- Test: `src/lib/skills/createSkillFlow.test.ts`

**Context:** Pure orchestration so it's unit-testable: given a provider name and an optional idea, create a session, set its provider, and prefill the composer. READ `src/stores/sessions.store.ts` (`create()` returns `SessionMeta` and calls `setActive`; `setProviderName(id, name)`) and `src/stores/skills.store.ts` (now exposes `paths` from Task 3 — add it to the store in this task if not already surfaced; see note). The prefill text embeds the absolute drafts path.

- [ ] **Step 1: Surface `paths` in the skills store** (small prerequisite)

In `src/stores/skills.store.ts`: add `paths: { skillsDir: string; draftsDir: string } | null` to state (default `null`), and set it in `init`/`refresh` from the `skillsApi.list()` result (which now returns `paths`). Update the existing `skills.store.test.ts` mock return values to include `paths` so they keep passing (e.g. `{ skills: [...], drafts: [], paths: { skillsDir: '/d/skills', draftsDir: '/d/skills/.drafts' } }`).

- [ ] **Step 2: Write the failing test** `src/lib/skills/createSkillFlow.test.ts`

```ts
import { vi } from 'vitest';

const create = vi.fn();
const setProviderName = vi.fn();
const setPendingComposerText = vi.fn();

vi.mock('@/src/stores/sessions.store', () => ({
  useSessionsStore: { getState: () => ({ create, setProviderName }) },
}));
vi.mock('@/src/stores/chat.store', () => ({
  useChatStore: { getState: () => ({ setPendingComposerText }) },
}));
vi.mock('@/src/stores/skills.store', () => ({
  useSkillsStore: { getState: () => ({ paths: { skillsDir: '/d/skills', draftsDir: '/d/skills/.drafts' } }) },
}));

import { createSkillFlow } from './createSkillFlow';

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: 'sess-1' });
  setProviderName.mockResolvedValue(undefined);
});

describe('createSkillFlow', () => {
  it('creates a session, sets the provider, and prefills the composer with @skill-smith and the drafts path', async () => {
    await createSkillFlow({ providerName: 'anthropic:claude-opus-4-8', idea: 'a PDF helper' });
    expect(create).toHaveBeenCalledOnce();
    expect(setProviderName).toHaveBeenCalledWith('sess-1', 'anthropic:claude-opus-4-8');
    const prefill = setPendingComposerText.mock.calls[0][0] as string;
    expect(prefill).toMatch(/^@skill-smith /);
    expect(prefill).toContain('/d/skills/.drafts');
    expect(prefill).toContain('a PDF helper');
  });

  it('omits the idea sentence when no idea is given', async () => {
    await createSkillFlow({ providerName: 'p', idea: '' });
    const prefill = setPendingComposerText.mock.calls[0][0] as string;
    expect(prefill.startsWith('@skill-smith ')).toBe(true);
  });
});
```

- [ ] **Step 3: Run it, confirm FAIL**

Run: `npx vitest run src/lib/skills/createSkillFlow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** `src/lib/skills/createSkillFlow.ts`

```ts
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useChatStore } from '@/src/stores/chat.store';
import { useSkillsStore } from '@/src/stores/skills.store';
import { SKILL_SMITH_NAME } from '@/server/domain/subagents/skill-smith';

export interface CreateSkillFlowInput {
  providerName: string;
  idea: string;
}

/**
 * Open a dedicated generation session: create + activate a session, bind the
 * chosen provider, and prefill the composer with an @skill-smith mention that
 * carries the absolute drafts path. The user reviews the prefilled message and
 * sends it to start the brainstorm → generate flow.
 */
export async function createSkillFlow({ providerName, idea }: CreateSkillFlowInput): Promise<void> {
  const sessions = useSessionsStore.getState();
  const session = await sessions.create();
  await sessions.setProviderName(session.id, providerName).catch(() => {});

  const draftsDir = useSkillsStore.getState().paths?.draftsDir ?? '.drafts';
  const trimmedIdea = idea.trim();
  const ideaSentence = trimmedIdea ? ` My idea: ${trimmedIdea}` : '';
  const prefill =
    `@${SKILL_SMITH_NAME} Help me create a new Aether skill. ` +
    `Write the generated skill into a new folder under \`${draftsDir}/<slug>/\`. ` +
    `Read your brainstorming and skill-creator guide skills first.${ideaSentence}`;

  useChatStore.getState().setPendingComposerText(prefill);
}
```
> NOTE: importing `SKILL_SMITH_NAME` from the server module is consistent with the repo's existing practice of importing server types/consts into the frontend (it's a plain string const, tree-shakeable, no server runtime pulled in). Confirm `sessions.create()` resolves to an object with `.id` and adapt if the real shape differs.

- [ ] **Step 5: Run tests, confirm PASS**

Run: `npx vitest run src/lib/skills/createSkillFlow.test.ts src/stores/skills.store.test.ts`
Expected: PASS (flow tests + store tests with updated `paths` mocks).

- [ ] **Step 6: Lint + commit**

Run: `npm run lint` → PASS.
```bash
git add src/lib/skills/createSkillFlow.ts src/lib/skills/createSkillFlow.test.ts src/stores/skills.store.ts src/stores/skills.store.test.ts
git commit -m "feat(skills): create-skill flow (session + provider + composer prefill)"
```

---

### Task 7: `CreateSkillModal` + UI store flag

**Files:**
- Modify: `src/stores/ui.store.ts`
- Create: `src/components/skills/CreateSkillModal.tsx`
- Modify: wherever modals are mounted (e.g. the layout that renders `SubAgentEditModal`/`DialogHost`)
- Modify: `src/i18n/en.ts`

**Context:** READ `src/stores/ui.store.ts` and `src/components/subagents/SubAgentEditModal.tsx` to mirror the open/close-flag modal pattern (e.g. `editingSubAgentId` + setter; modal returns `null` when closed). READ `src/stores/providers.store.ts` for the provider list shape (`ProviderDescriptor { name, displayName, ... }`) and the current default. The modal: a provider `<select>` (default = current default provider), an optional idea `<textarea>`, a Start button that calls `createSkillFlow({ providerName, idea })` then closes.

- [ ] **Step 1: Add the UI flag** in `src/stores/ui.store.ts`

Mirror the existing boolean/flag pattern. Add `creatingSkill: boolean` (default `false`) and a setter `setCreatingSkill: (v: boolean) => void`. (If the store uses a different idiom, e.g. an id or an enum of open modals, follow that idiom instead.)

- [ ] **Step 2: Add i18n strings** in `src/i18n/en.ts`, inside the `skills` block:

```ts
    createWithAi: 'Create with AI',
    createTitle: 'Create a skill with AI',
    createModel: 'Model',
    createIdea: 'Your idea (optional)',
    createIdeaPlaceholder: 'e.g. a skill for writing conventional commits',
    createStart: 'Start',
    createCancel: 'Cancel',
```

- [ ] **Step 3: Implement** `src/components/skills/CreateSkillModal.tsx`

```tsx
import { useState } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { createSkillFlow } from '@/src/lib/skills/createSkillFlow';
import { t } from '@/src/i18n/t';

export function CreateSkillModal() {
  const open = useUiStore((s) => s.creatingSkill);
  const setOpen = useUiStore((s) => s.setCreatingSkill);
  const providers = useProvidersStore((s) => s.list);
  const defaultProvider = useProvidersStore((s) => s.defaultProvider);
  const [providerName, setProviderName] = useState<string>('');
  const [idea, setIdea] = useState('');

  if (!open) return null;
  const selected = providerName || defaultProvider || providers[0]?.name || '';

  const start = async () => {
    if (!selected) return;
    setOpen(false);
    await createSkillFlow({ providerName: selected, idea }).catch(() => {});
    setIdea('');
    setProviderName('');
  };

  return (
    <div role="dialog" aria-label={t('skills.createTitle')} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[28rem] max-w-[90vw] rounded border border-border-subtle bg-zinc-950 p-4 space-y-3">
        <div className="mono-label">{t('skills.createTitle')}</div>

        <label className="block text-[11px] text-zinc-400">
          {t('skills.createModel')}
          <select
            value={selected}
            onChange={(e) => setProviderName(e.target.value)}
            className="mt-1 w-full bg-zinc-900 border border-border-subtle rounded p-1 text-[11px]"
          >
            {providers.map((p) => (
              <option key={p.name} value={p.name}>{p.displayName}</option>
            ))}
          </select>
        </label>

        <label className="block text-[11px] text-zinc-400">
          {t('skills.createIdea')}
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder={t('skills.createIdeaPlaceholder')}
            rows={3}
            className="mt-1 w-full bg-zinc-900 border border-border-subtle rounded p-1 text-[11px]"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="text-[11px] text-zinc-400 hover:text-white px-2 py-1">
            {t('skills.createCancel')}
          </button>
          <button onClick={start} disabled={!selected} className="text-[11px] text-manipulation hover:underline px-2 py-1 disabled:opacity-40">
            {t('skills.createStart')}
          </button>
        </div>
      </div>
    </div>
  );
}
```
> NOTE: reuse the project's real modal styling/tokens — check `SubAgentEditModal.tsx` and match its container/overlay classes rather than the inline ones above if they differ. Confirm `useProvidersStore` exposes `list` and `defaultProvider` (Task explored: it does).

- [ ] **Step 4: Mount the modal** next to the other modals (find where `SubAgentEditModal` or `DialogHost` is rendered — likely a layout component) and add `<CreateSkillModal />`.

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` → PASS.
```bash
git add src/stores/ui.store.ts src/components/skills/CreateSkillModal.tsx src/i18n/en.ts <the-layout-file-you-edited>
git commit -m "feat(skills): Create-with-AI modal (model picker + idea)"
```

---

### Task 8: "Create with AI" button in the Skills section

**Files:**
- Modify: `src/components/sidebar/SkillsSection.tsx`

**Context:** Add a second button beside the existing "+ Deploy New Skill" that opens the modal via `useUiStore.setCreatingSkill(true)`.

- [ ] **Step 1: Wire the button**

Add the hook near the others:
```tsx
import { useUiStore } from '@/src/stores/ui.store';
// ...
const openCreateWithAi = useUiStore((s) => s.setCreatingSkill);
```
Add the button right after the existing "+ Deploy New Skill" button:
```tsx
<button
  onClick={() => openCreateWithAi(true)}
  aria-label={t('skills.createWithAi')}
  className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-manipulation transition-colors mt-1"
>
  ✨ {t('skills.createWithAi')}
</button>
```

- [ ] **Step 2: Lint + verify SkillsSection tests still pass**

Run: `npm run lint` → PASS.
Run: `npx vitest run src/components/sidebar/SkillsSection.test.tsx` → PASS (no regression).

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/SkillsSection.tsx
git commit -m "feat(skills): Create-with-AI entry point in Skills section"
```

---

## Phase E — Verification

### Task 9: Full verification + manual end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `npm run lint` → PASS.

- [ ] **Step 2: Full test suite**

Run: `npm run test:run` → PASS (all green, including the new Plan 2 tests).

- [ ] **Step 3: Coverage on touched globs**

Run: `npm run test:coverage`
Expected: the new files (`server/domain/subagents/skill-smith.ts`, `src/lib/skills/createSkillFlow.ts`) are covered by their tests. NOTE: repo-wide thresholds for `src/hooks/**` (and some other globs) were ALREADY failing before this work — confirm Plan 2's new files are individually well-covered and that you did not WORSEN the affected globs; do not attempt to fix pre-existing unrelated gaps.

- [ ] **Step 4: Manual end-to-end (real app)**

Run `AETHER_FAKE_PROVIDER=1 npm run dev`, open http://localhost:3000.
Verify:
1. The Skills sidebar shows a "✨ Create with AI" button.
2. Clicking it opens the modal with a model `<select>` (populated) and an idea field.
3. Choosing a model + (optional) idea + Start: a NEW session becomes active, and the composer is prefilled with `@skill-smith …` containing the `.drafts` path; the `@skill-smith` mention resolves (typing/leaving it shows the subagent is known).
4. Sending the message dispatches against the chosen model with the skill-smith system instruction in effect. (With the Fake provider you won't get real generation, but confirm no errors and that the mention is recognized + the subagent instruction is applied — check the assembled prompt path / no "unknown subagent" behavior.)
5. (Real provider, optional) With the filesystem MCP enabled and rooted at/above the skills dir, confirm the model can write a draft into `.drafts/<slug>/` and it then appears under "Drafts" in the Skills section, promotable via Plan 1's flow.

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "test(skills): Plan 2 verification for AI-assisted generation"
```

---

## Self-review (completed during planning)

- **Spec coverage (§7 of the design):** dedicated session reusing dispatch → Tasks 6-8 (a normal session + provider + mention, no dispatch changes); brainstorming + skill-creator active → Task 1 (skill-smith instruction directs reading both guide skills from disk) + Plan 1's bundled defaults; write to `.drafts/` via filesystem MCP → Task 1 instruction + the path injected by Task 6; review→promote → Plan 1 (unchanged). Model selection among available providers → Task 7 modal.
- **Architecture decisions honored:** subagent (not dispatch override) → Task 1; existing filesystem MCP with guardrails (path injected, write confined to `.drafts/` by instruction; Plan 1's fs-MCP-off warning already nudges enabling it) → Tasks 1, 6. No core dispatch / MCP-registry / breakpoint changes anywhere.
- **Placeholder scan:** the "NOTE" blocks all point at real files to confirm signatures (store `create` input, `reset()` behavior, modal styling, provider store shape) — adaptive integration guidance, not unfinished code. All production code is complete.
- **Type consistency:** `SKILL_SMITH_NAME`/`seedSkillSmith` (Tasks 1,2,6); `SkillsList.paths` (Tasks 3,6); `pendingComposerText`/`setPendingComposerText` (Tasks 4,5,6); `creatingSkill`/`setCreatingSkill` (Tasks 7,8); `createSkillFlow` input `{ providerName, idea }` (Tasks 6,7).
- **Out of scope (unchanged from Plan 1):** per-profile skill overrides, script execution, in-UI SKILL.md editing, and any auto-approval/headless machinery (the generation session is interactive and uses normal tool gating).
