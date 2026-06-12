# Skill Selection Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each context skill be enabled/disabled with a click; only enabled skills are injected into the model prompt as an `# Active Skills` block.

**Architecture:** Skills become structured objects `{ name, enabled }` persisted in `context_skills` (new `enabled` column). `assemble()` filters enabled skills and appends them to the system instruction (skills reach the model for the first time). A dedicated `PATCH /api/context/skills/:index/enabled` route + an optimistic store action drive the on-click toggle in `SkillsSection`.

**Tech Stack:** TypeScript, better-sqlite3 (numbered SQL migrations), Express + Zod, React 19 + Zustand, Vitest (backend `node` project + frontend `jsdom` project).

---

## File Structure

- **Create:** `server/db/migrations/012_skill_enabled.sql` — adds `enabled` column.
- **Modify:** `server/domain/context/context.types.ts` — `Skill` type, `skills: Skill[]`.
- **Modify:** `server/domain/context/context.schema.ts` — `SkillSchema` + legacy-string normalization.
- **Modify:** `server/domain/context/context.store.ts` — read/write `enabled`, `addSkill` default, new `setSkillEnabledAt`, adapt `updateSkillAt`.
- **Modify:** `server/domain/dispatch/prompt-assembler.ts` — filter enabled + inject `# Active Skills`.
- **Modify:** `server/domain/profiles/profiles.store.ts` — snapshot uses `s.name`; read maps to `{ name, enabled: true }`.
- **Modify:** `server/routes/context.routes.ts` — `PATCH /skills/:index/enabled`.
- **Modify:** `src/lib/api/context.api.ts` — `setSkillEnabledAt`.
- **Modify:** `src/stores/context.store.ts` — adapt skill actions + new `toggleSkillAt`.
- **Modify:** `src/components/sidebar/SkillsSection.tsx` — render name, dimmed disabled, row-click toggle, `[active/total]`.

> **Spec deviation (intentional):** the spec proposed `PATCH /skills/:index` for the toggle, but that path already renames a skill (`{ value }`). The toggle uses a dedicated sub-path `PATCH /skills/:index/enabled` instead.

---

## Task 1: Migration — `enabled` column

**Files:**
- Create: `server/db/migrations/012_skill_enabled.sql`
- Test: `server/domain/context/context.store.test.ts` (covered in Task 3; `makeTestDb` applies all migrations)

- [ ] **Step 1: Create the migration**

Create `server/db/migrations/012_skill_enabled.sql`:

```sql
-- Skills can be individually enabled/disabled; only enabled ones are injected
-- into the prompt. Existing skills default to enabled (no behavior change).
ALTER TABLE context_skills ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 2: Verify it applies**

Run: `npx vitest run server/db/migrate.test.ts`
Expected: PASS (migrations apply cleanly in order). If no such test exists, instead run any backend store test that uses `makeTestDb`, e.g. `npx vitest run server/domain/context/context.store.test.ts` — Expected: PASS (no SQL error).

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/012_skill_enabled.sql
git commit -m "feat(db): migration 012 — context_skills.enabled column"
```

---

## Task 2: Backend types + schema

**Files:**
- Modify: `server/domain/context/context.types.ts`
- Modify: `server/domain/context/context.schema.ts`
- Test: `server/domain/context/context.schema.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Append to `server/domain/context/context.schema.test.ts` (create the file with this content if it does not exist):

```ts
import { describe, it, expect } from 'vitest';
import { AetherContextSchema } from './context.schema';

describe('AetherContextSchema skills', () => {
  it('accepts structured skills with enabled', () => {
    const parsed = AetherContextSchema.parse({
      systemInstruction: 's',
      skills: [{ name: 'web-search', enabled: false }],
      tools: [],
      mcpServers: [],
    });
    expect(parsed.skills).toEqual([{ name: 'web-search', enabled: false }]);
  });

  it('normalizes legacy plain-string skills to enabled:true', () => {
    const parsed = AetherContextSchema.parse({
      systemInstruction: 's',
      skills: ['legacy-skill'],
      tools: [],
      mcpServers: [],
    });
    expect(parsed.skills).toEqual([{ name: 'legacy-skill', enabled: true }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/context/context.schema.test.ts`
Expected: FAIL — the legacy-string case yields `'legacy-skill'` (a string), not `{ name, enabled: true }`.

- [ ] **Step 3: Update the type**

In `server/domain/context/context.types.ts`, add the `Skill` interface above `AetherContext` and change the `skills` field:

```ts
export interface Skill {
  name: string;
  enabled: boolean;
}
```

In the same file, change `AetherContext.skills`:

```ts
  skills: Skill[];
```

- [ ] **Step 4: Update the schema**

In `server/domain/context/context.schema.ts`, add `SkillSchema` (after `ToolSchema`):

```ts
export const SkillSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
});

// Accept legacy plain-string skills (export envelopes, profiles) and normalize
// them to { name, enabled: true }.
const SkillEntrySchema = z.union([
  z.string().min(1).transform((name) => ({ name, enabled: true })),
  SkillSchema,
]);
```

Change `AetherContextSchema.skills` from `z.array(z.string())` to:

```ts
  skills: z.array(SkillEntrySchema),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/domain/context/context.schema.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/domain/context/context.types.ts server/domain/context/context.schema.ts server/domain/context/context.schema.test.ts
git commit -m "feat(context): Skill {name,enabled} type + legacy-string normalization"
```

---

## Task 3: ContextStore — persist + toggle

**Files:**
- Modify: `server/domain/context/context.store.ts`
- Test: `server/domain/context/context.store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/domain/context/context.store.test.ts` (use the existing `makeTestDb` import already in that file; if a `ContextStore` constructor helper differs, mirror the existing tests in the file):

```ts
import { ContextStore } from './context.store';
import { makeTestDb } from '@/server/test/test-db';

describe('ContextStore skill enabled flag', () => {
  it('adds skills enabled by default and toggles them', async () => {
    const store = new ContextStore(makeTestDb());
    await store.addSkill('web-search');
    let ctx = await store.read();
    expect(ctx.skills).toEqual([{ name: 'web-search', enabled: true }]);

    await store.setSkillEnabledAt(0, false);
    ctx = await store.read();
    expect(ctx.skills[0]).toEqual({ name: 'web-search', enabled: false });
  });

  it('throws NotFoundError for an out-of-range toggle index', async () => {
    const store = new ContextStore(makeTestDb());
    await expect(store.setSkillEnabledAt(5, true)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/context/context.store.test.ts -t "skill enabled flag"`
Expected: FAIL — `setSkillEnabledAt` is not a function / skills are strings.

- [ ] **Step 3: Update `readSync` skills mapping**

In `server/domain/context/context.store.ts`, replace the skills read block (currently selecting only `name`):

```ts
    const skills = (
      this.db
        .prepare('SELECT name, enabled FROM context_skills ORDER BY position')
        .all() as { name: string; enabled: number }[]
    ).map((r) => ({ name: r.name, enabled: r.enabled === 1 }));
```

- [ ] **Step 4: Update `writeAll` skills insert**

In the same file, replace the skills insert block inside the transaction:

```ts
      this.db.prepare('DELETE FROM context_skills').run();
      const insertSkill = this.db.prepare(
        'INSERT INTO context_skills (position, name, enabled) VALUES (?, ?, ?)',
      );
      next.skills.forEach((s, i) => insertSkill.run(i, s.name, s.enabled ? 1 : 0));
```

- [ ] **Step 5: Update `addSkill` and `updateSkillAt`, add `setSkillEnabledAt`**

Replace `addSkill` body's `writeAll` line:

```ts
    this.writeAll({ ...cur, skills: [...cur.skills, { name: trimmed, enabled: true }] });
```

Replace `updateSkillAt`'s mutation (keep the index guard + trim validation above it):

```ts
    const skills = [...cur.skills];
    skills[index] = { ...skills[index], name: trimmed };
    this.writeAll({ ...cur, skills });
```

Add a new method (after `updateSkillAt`):

```ts
  async setSkillEnabledAt(index: number, enabled: boolean): Promise<void> {
    const cur = this.readSync();
    if (index < 0 || index >= cur.skills.length) {
      throw new NotFoundError(`skill index ${index}`);
    }
    const skills = [...cur.skills];
    skills[index] = { ...skills[index], enabled };
    this.writeAll({ ...cur, skills });
  }
```

(`removeSkillAt` needs no change — it filters by index and works on `Skill[]`.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run server/domain/context/context.store.test.ts`
Expected: PASS (the whole file — confirm no other skills-string assertions remain; if an older test asserts `skills` equals `['x']`, update it to `[{ name: 'x', enabled: true }]`).

- [ ] **Step 7: Commit**

```bash
git add server/domain/context/context.store.ts server/domain/context/context.store.test.ts
git commit -m "feat(context): persist skill enabled flag + setSkillEnabledAt"
```

---

## Task 4: prompt-assembler — inject active skills

**Files:**
- Modify: `server/domain/dispatch/prompt-assembler.ts`
- Test: `server/domain/dispatch/prompt-assembler.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/domain/dispatch/prompt-assembler.test.ts` (mirror the existing helper that builds an `AetherContext` in that file; the snippet below constructs a minimal context inline):

```ts
import { assemble } from './prompt-assembler';
import type { AetherContext } from '@/server/domain/context/context.types';

function ctxWith(skills: AetherContext['skills']): AetherContext {
  return { systemInstruction: 'BASE', skills, tools: [], mcpServers: [] };
}

describe('assemble active skills block', () => {
  it('injects only enabled skills into the system instruction', () => {
    const ctx = ctxWith([
      { name: 'web-search', enabled: true },
      { name: 'disabled-one', enabled: false },
    ]);
    const out = assemble(ctx, null, 'hi', null, []);
    expect(out.systemInstruction).toContain('# Active Skills');
    expect(out.systemInstruction).toContain('- web-search');
    expect(out.systemInstruction).not.toContain('disabled-one');
    expect(out.skills).toEqual(['web-search']);
  });

  it('adds no block when no skill is enabled', () => {
    const ctx = ctxWith([{ name: 'x', enabled: false }]);
    const out = assemble(ctx, null, 'hi', null, []);
    expect(out.systemInstruction).not.toContain('# Active Skills');
    expect(out.skills).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/dispatch/prompt-assembler.test.ts -t "active skills block"`
Expected: FAIL — `ctx.skills.filter`/`.map` on objects, no `# Active Skills` block emitted.

- [ ] **Step 3: Implement the helpers and use them**

In `server/domain/dispatch/prompt-assembler.ts`, add helpers after the existing `dedupToolsById` function:

```ts
function activeSkillNames(skills: AetherContext['skills']): string[] {
  return skills.filter((s) => s.enabled).map((s) => s.name);
}

function withSkillsBlock(systemInstruction: string, skillNames: string[]): string {
  if (skillNames.length === 0) return systemInstruction;
  const block = ['# Active Skills', ...skillNames.map((n) => `- ${n}`)].join('\n');
  return [systemInstruction.trim(), block].filter(Boolean).join('\n\n');
}
```

Replace the no-subagent branch of `assemble`:

```ts
  if (!subAgent) {
    const skills = activeSkillNames(ctx.skills);
    return {
      systemInstruction: withSkillsBlock(ctx.systemInstruction, skills),
      skills,
      tools: ctx.tools,
      message: parsedMessage,
      subAgent: null,
      mcpTools,
    };
  }
```

Replace the sub-agent branch's `sys`/`skills`/return:

```ts
  const baseSys = [
    ctx.systemInstruction.trim(),
    `# Sub-agent: ${subAgent.name}`,
    subAgent.systemInstruction.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  const skills = dedupStrings([...activeSkillNames(ctx.skills), ...subAgent.skills]);
  const tools = dedupToolsById([...ctx.tools, ...subAgent.tools]);
  return {
    systemInstruction: withSkillsBlock(baseSys, skills),
    skills,
    tools,
    message: parsedMessage,
    subAgent: resolvedName,
    mcpTools,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/dispatch/prompt-assembler.test.ts`
Expected: PASS (whole file — update any prior test that built `ctx.skills` as `string[]` to use `{ name, enabled: true }`).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/prompt-assembler.ts server/domain/dispatch/prompt-assembler.test.ts
git commit -m "feat(dispatch): inject enabled skills as # Active Skills block"
```

---

## Task 5: Profiles store — adapt to Skill[]

**Files:**
- Modify: `server/domain/profiles/profiles.store.ts`
- Test: `server/domain/profiles/profiles.store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/domain/profiles/profiles.store.test.ts` (mirror existing setup in that file for constructing a `ProfilesStore` with `makeTestDb`):

```ts
import { ProfilesStore } from './profiles.store';
import { makeTestDb } from '@/server/test/test-db';

describe('ProfilesStore skills shape', () => {
  it('round-trips context skills as enabled Skill objects', async () => {
    const store = new ProfilesStore(makeTestDb());
    const created = await store.create({
      name: 'p1',
      context: {
        systemInstruction: 's',
        skills: [{ name: 'web-search', enabled: true }],
        tools: [],
        mcpServers: [],
      },
      thinkingEnabled: false,
    });
    const read = await store.read(created.id);
    expect(read?.context.skills).toEqual([{ name: 'web-search', enabled: true }]);
  });
});
```

> If `create`'s argument shape differs in the existing tests, copy that file's existing creation pattern verbatim and only assert on `context.skills`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/profiles/profiles.store.test.ts -t "skills shape"`
Expected: FAIL — snapshot writes `[object Object]` (insert used the whole `Skill` as the name) and/or read returns strings.

- [ ] **Step 3: Fix snapshot write**

In `server/domain/profiles/profiles.store.ts`, change the skill snapshot line (currently `context.skills.forEach((s, i) => insertSkill.run(profileId, i, s));`):

```ts
    context.skills.forEach((s, i) => insertSkill.run(profileId, i, s.name));
```

- [ ] **Step 4: Fix read mapping**

In the same file, change the `skills` read mapping (currently `.map((r) => r.name)`):

```ts
    const skills = (
      this.db
        .prepare('SELECT name FROM profile_skills WHERE profile_id = ? ORDER BY position')
        .all(id) as { name: string }[]
    ).map((r) => ({ name: r.name, enabled: true }));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/domain/profiles/profiles.store.test.ts`
Expected: PASS (whole file — update any prior test asserting `context.skills` as `string[]`).

- [ ] **Step 6: Commit**

```bash
git add server/domain/profiles/profiles.store.ts server/domain/profiles/profiles.store.test.ts
git commit -m "fix(profiles): snapshot/restore context skills as Skill objects"
```

---

## Task 6: Route — toggle endpoint

**Files:**
- Modify: `server/routes/context.routes.ts`
- Test: `server/routes/context.routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/routes/context.routes.test.ts` (reuse the existing app/store test harness in that file; the snippet assumes a `makeApp()`-style helper returning `{ app }` — mirror whatever the file already uses):

```ts
it('PATCH /api/context/skills/:index/enabled toggles a skill', async () => {
  const { app } = makeApp();
  await request(app).post('/api/context/skills').send({ name: 'web-search' });

  const res = await request(app)
    .patch('/api/context/skills/0/enabled')
    .send({ enabled: false });
  expect(res.status).toBe(200);

  const ctx = await request(app).get('/api/context');
  expect(ctx.body.skills[0]).toEqual({ name: 'web-search', enabled: false });
});

it('PATCH /skills/:index/enabled rejects a non-boolean body', async () => {
  const { app } = makeApp();
  await request(app).post('/api/context/skills').send({ name: 'x' });
  const res = await request(app)
    .patch('/api/context/skills/0/enabled')
    .send({ enabled: 'nope' });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routes/context.routes.test.ts -t "enabled"`
Expected: FAIL — route returns 404 (no such route).

- [ ] **Step 3: Add the body schema + route**

In `server/routes/context.routes.ts`, add near the other body schemas (after `SkillUpdateBody`):

```ts
const SkillEnabledBody = z.object({ enabled: z.boolean() });
```

Add the route immediately after the existing `router.patch('/skills/:index', ...)` block:

```ts
  router.patch(
    '/skills/:index/enabled',
    asyncHandler(async (req, res) => {
      const index = parseInt(req.params.index, 10);
      if (Number.isNaN(index)) throw new ValidationError('Invalid index');
      const parsed = SkillEnabledBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid enabled body', parsed.error);
      await store.setSkillEnabledAt(index, parsed.data.enabled);
      res.json({ status: 'ok' });
    }),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/routes/context.routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/context.routes.ts server/routes/context.routes.test.ts
git commit -m "feat(context): PATCH /skills/:index/enabled route"
```

---

## Task 7: Frontend API client

**Files:**
- Modify: `src/lib/api/context.api.ts`
- Test: `src/lib/api/context.api.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/api/context.api.test.ts` (mirror the file's existing fetch-mock pattern):

```ts
it('setSkillEnabledAt PATCHes the enabled sub-route', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  await contextApi.setSkillEnabledAt(2, false);
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/context/skills/2/enabled',
    expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) }),
  );
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/api/context.api.test.ts -t "setSkillEnabledAt"`
Expected: FAIL — `contextApi.setSkillEnabledAt is not a function`.

- [ ] **Step 3: Add the client method**

In `src/lib/api/context.api.ts`, add after `updateSkillAt`:

```ts
  setSkillEnabledAt: (index: number, enabled: boolean) =>
    fetch(`${BASE}/skills/${index}/enabled`, json('PATCH', { enabled })).then(noContent),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/api/context.api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/context.api.ts src/lib/api/context.api.test.ts
git commit -m "feat(api): contextApi.setSkillEnabledAt"
```

---

## Task 8: Frontend store — adapt + toggle action

**Files:**
- Modify: `src/stores/context.store.ts`
- Test: `src/stores/context.store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/stores/context.store.test.ts` (mirror existing store-test setup; the store is `useContextStore`):

```ts
it('toggleSkillAt optimistically flips enabled and rolls back on error', async () => {
  const spy = vi.spyOn(contextApi, 'setSkillEnabledAt').mockRejectedValueOnce(new Error('boom'));
  useContextStore.setState({
    context: { systemInstruction: '', skills: [{ name: 'a', enabled: true }], tools: [], mcpServers: [] },
    error: null,
  });
  await expect(useContextStore.getState().toggleSkillAt(0)).rejects.toThrow();
  // rolled back to enabled:true after the API rejection
  expect(useContextStore.getState().context?.skills[0]).toEqual({ name: 'a', enabled: true });
  spy.mockRestore();
});
```

> Import `contextApi` from `@/src/lib/api/context.api` in the test file if not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/context.store.test.ts -t "toggleSkillAt"`
Expected: FAIL — `toggleSkillAt is not a function`.

- [ ] **Step 3: Update the `ContextState` interface**

In `src/stores/context.store.ts`, in the `ContextState` interface, change the skill action signatures and add the toggle:

```ts
  addSkill: (name: string) => Promise<void>;
  updateSkillAt: (i: number, v: string) => Promise<void>;
  toggleSkillAt: (i: number) => Promise<void>;
  removeSkillAt: (i: number) => Promise<void>;
```

- [ ] **Step 4: Adapt `addSkill` and `updateSkillAt`, add `toggleSkillAt`**

Replace the optimistic `set` in `addSkill`:

```ts
    set({ context: { ...prev, skills: [...prev.skills, { name, enabled: true }] } });
```

Replace the mutation in `updateSkillAt`:

```ts
    const next = [...prev.skills];
    next[i] = { ...next[i], name: v };
    set({ context: { ...prev, skills: next } });
```

Add `toggleSkillAt` after `updateSkillAt`:

```ts
  toggleSkillAt: async (i) => {
    const prev = get().context;
    if (!prev) return;
    const current = prev.skills[i];
    if (!current) return;
    const nextEnabled = !current.enabled;
    const next = [...prev.skills];
    next[i] = { ...current, enabled: nextEnabled };
    set({ context: { ...prev, skills: next } });
    try {
      await contextApi.setSkillEnabledAt(i, nextEnabled);
    } catch (e) {
      set({ context: prev, error: errMsg(e) });
      throw e;
    }
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/stores/context.store.test.ts`
Expected: PASS (whole file — update any prior test that set `skills` as `string[]` to use `{ name, enabled: true }`).

- [ ] **Step 6: Commit**

```bash
git add src/stores/context.store.ts src/stores/context.store.test.ts
git commit -m "feat(store): toggleSkillAt + Skill object skill actions"
```

---

## Task 9: SkillsSection UI — click to toggle

**Files:**
- Modify: `src/components/sidebar/SkillsSection.tsx`
- Test: `src/components/sidebar/SkillsSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/components/sidebar/SkillsSection.test.tsx` (mirror the file's existing render/setup with a seeded `useContextStore`):

```ts
it('clicking a skill row toggles it and dims a disabled skill', async () => {
  const toggle = vi.fn().mockResolvedValue(undefined);
  useContextStore.setState({
    context: {
      systemInstruction: '',
      skills: [{ name: 'web-search', enabled: false }],
      tools: [],
      mcpServers: [],
    },
    toggleSkillAt: toggle,
  } as never);

  render(<SkillsSection />);
  const row = screen.getByText('web-search').closest('[data-skill-row]') as HTMLElement;
  expect(row.className).toMatch(/line-through|opacity/);
  await userEvent.click(row);
  expect(toggle).toHaveBeenCalledWith(0);
});
```

> Use the test file's existing imports for `render`, `screen`, `userEvent`, and `useContextStore`. If the file lacks `userEvent`, use `fireEvent.click(row)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/sidebar/SkillsSection.test.tsx -t "toggles"`
Expected: FAIL — no `data-skill-row` element / no toggle wiring.

- [ ] **Step 3: Update the component**

In `src/components/sidebar/SkillsSection.tsx`:

Add the toggle selector near the other store selectors:

```ts
  const toggleSkillAt = useContextStore((s) => s.toggleSkillAt);
```

Change the header counter line to show active/total:

```tsx
        <span className="text-[10px] text-zinc-600">
          [{skills.filter((s) => s.enabled).length}/{skills.length}]
        </span>
```

Replace the skill row `map(...)` block with a clickable, state-aware row:

```tsx
        {skills.map((skill, i) => (
          <div
            key={`${i}-${skill.name}`}
            data-skill-row
            role="button"
            tabIndex={0}
            onClick={() => toggleSkillAt(i).catch(() => {})}
            aria-pressed={skill.enabled}
            className={`group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono cursor-pointer ${
              skill.enabled
                ? 'text-zinc-400 hover:border-manipulation/40'
                : 'text-zinc-600 line-through opacity-60'
            }`}
          >
            <span className="truncate">{skill.name}</span>
            <div className="hidden group-hover:flex gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleEdit(i, skill.name);
                }}
                aria-label={`Edit ${skill.name}`}
                className="hover:text-white"
              >
                ✎
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(i, skill.name);
                }}
                aria-label={`Remove ${skill.name}`}
                className="hover:text-status-error"
              >
                ×
              </button>
            </div>
          </div>
        ))}
```

> Note: `handleEdit`/`handleRemove` are already defined in the file and take `(index, currentName)`; the calls above pass `skill.name`. The `EMPTY_SKILLS` constant's type changes implicitly to `Skill[]` — update its declaration to `const EMPTY_SKILLS: import('@/src/types/context.types').Skill[] = [];` (or import `Skill` at the top).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/sidebar/SkillsSection.test.tsx`
Expected: PASS (whole file — update any prior test that seeded `skills` as `string[]` or asserted on string rows).

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/SkillsSection.tsx src/components/sidebar/SkillsSection.test.tsx
git commit -m "feat(ui): click-to-toggle skill selection with dimmed disabled state"
```

---

## Task 10: Full verification

- [ ] **Step 1: Type-check**

Run: `npm run lint`
Expected: clean (no errors). Fix any remaining `string` vs `Skill` mismatches the compiler surfaces (likely in tests that seeded `skills` as `string[]`).

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 3: Final commit (if any fixups)**

```bash
git add -A
git commit -m "test: align skills fixtures with Skill {name,enabled} shape"
```

---

## Self-review notes (author)

- **Spec coverage:** data model (Task 1–2), store + toggle (Task 3), real prompt injection (Task 4), profiles ripple (Task 5), API (Task 6–7), store action (Task 8), UX (Task 9), verification (Task 10). All spec sections mapped.
- **Spec deviation:** toggle uses `PATCH /skills/:index/enabled` (the `:index` path already renames). Documented above.
- **Type consistency:** `Skill { name: string; enabled: boolean }` used identically across backend types, schema, store, assembler, profiles, frontend types, store, and component. `setSkillEnabledAt` (store/route) and `toggleSkillAt` (frontend store) names are stable across tasks.
- **Known cross-cutting fixups:** several existing tests seed `skills` as `string[]`; Tasks 3/4/5/8/9 each note "update prior string-shaped assertions," and Task 10 catches anything remaining via `npm run lint` + full suite.
