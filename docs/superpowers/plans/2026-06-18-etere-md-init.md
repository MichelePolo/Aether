# ETERE.md init skill + project-memory ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a seeded `init` skill that writes `ETERE.md` per workspace, and make `DispatchService` auto-inject that workspace's `ETERE.md` (plus runtime facts) into the system instruction of every dispatch.

**Architecture:** A pure `project-memory.ts` reader (root → capped ETERE.md string); `assemble()` gains two optional string params (`runtimeFacts`, `projectMemory`) injected after the base/sub-agent instruction and before `# Active Skills` via a shared `withRuntimeContext()` helper; `DispatchService` resolves the active session's workspace root through an injected `projectRootFor` dep, reads ETERE.md, builds runtime facts (UTC time + active `transport:model`), and passes both into `assemble()` (in `handle()`) and `withRuntimeContext()` (in `resume()`); the composition root wires `projectRootFor`. The generation half is a static `SKILL.md` — no runtime code.

**Tech Stack:** TypeScript (strict, `noEmit`), Node `better-sqlite3`, Express, Vitest (two projects: `backend` node / `frontend` jsdom). Skills are on-disk `SKILL.md` dirs seeded from `server/skills/defaults/`.

## Global Constraints

- **Provider-agnostic copy:** ETERE.md and the `init` skill must never reference "Claude"/"Anthropic" or any vendor/product. Persona is "Aether". (Verbatim rule from `2026-06-17-aether-system-prompt-design.md`.)
- **`assemble()` stays pure & synchronous:** no filesystem/clock I/O inside it. All I/O lives in `DispatchService`; all root-resolution policy lives in the composition root (`server/index.ts`).
- **Size cap:** project memory injected into every dispatch is capped at **32 KB** (`PROJECT_MEMORY_CAP_BYTES = 32 * 1024`), truncated with an explicit notice.
- **Filename:** exactly `ETERE.md` (`ETERE_FILENAME`).
- **Import alias:** `@/*` is the repo root; write imports as `@/server/...`. Relative imports inside the same dir are used in existing dispatch files (match neighbors).
- **Tests colocated** as `*.test.ts`; Vitest globals are on (no `describe/it/expect` import needed, though existing files import them — match the file you edit).
- **Coverage ≥ 80%** enforced on `server/domain/**` and `server/lib/**`.

---

### Task 1: `project-memory.ts` reader module

**Files:**
- Create: `server/domain/dispatch/project-memory.ts`
- Test: `server/domain/dispatch/project-memory.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `ETERE_FILENAME: string` = `'ETERE.md'`
  - `PROJECT_MEMORY_CAP_BYTES: number` = `32 * 1024`
  - `readProjectMemory(root: string | null): string | null`

- [ ] **Step 1: Write the failing test**

Create `server/domain/dispatch/project-memory.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readProjectMemory, ETERE_FILENAME, PROJECT_MEMORY_CAP_BYTES } from './project-memory';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'etere-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readProjectMemory', () => {
  it('returns null when root is null', () => {
    expect(readProjectMemory(null)).toBeNull();
  });

  it('returns null when ETERE.md is absent', () => {
    expect(readProjectMemory(root)).toBeNull();
  });

  it('returns null when ETERE.md is empty/whitespace', () => {
    writeFileSync(path.join(root, ETERE_FILENAME), '   \n\t');
    expect(readProjectMemory(root)).toBeNull();
  });

  it('returns the file content verbatim when under the cap', () => {
    const content = '# ETERE.md — demo\n\nProject notes.';
    writeFileSync(path.join(root, ETERE_FILENAME), content);
    expect(readProjectMemory(root)).toBe(content);
  });

  it('returns null when root path is a directory without the file', () => {
    mkdirSync(path.join(root, 'sub'));
    expect(readProjectMemory(path.join(root, 'sub'))).toBeNull();
  });

  it('truncates with a notice when over the cap', () => {
    const big = 'x'.repeat(PROJECT_MEMORY_CAP_BYTES + 5000);
    writeFileSync(path.join(root, ETERE_FILENAME), big);
    const out = readProjectMemory(root)!;
    expect(out).not.toBeNull();
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain('truncated');
    expect(out).toContain(String(PROJECT_MEMORY_CAP_BYTES));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/dispatch/project-memory.test.ts`
Expected: FAIL — cannot resolve `./project-memory`.

- [ ] **Step 3: Write minimal implementation**

Create `server/domain/dispatch/project-memory.ts`:

```ts
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Canonical project-memory filename, read from the workspace root. */
export const ETERE_FILENAME = 'ETERE.md';

/** Hard cap on injected project memory; it competes with the task for tokens. */
export const PROJECT_MEMORY_CAP_BYTES = 32 * 1024;

/**
 * Read <root>/ETERE.md for injection into the system instruction. Returns null
 * when there is no root, the file is absent/unreadable, or it is empty/whitespace.
 * Content over the cap is truncated to PROJECT_MEMORY_CAP_BYTES with a notice.
 */
export function readProjectMemory(root: string | null): string | null {
  if (!root) return null;
  const file = path.join(root, ETERE_FILENAME);
  let raw: string;
  try {
    if (!statSync(file).isFile()) return null;
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (raw.trim().length === 0) return null;
  if (Buffer.byteLength(raw, 'utf8') <= PROJECT_MEMORY_CAP_BYTES) return raw;
  const truncated = Buffer.from(raw, 'utf8')
    .subarray(0, PROJECT_MEMORY_CAP_BYTES)
    .toString('utf8');
  return `${truncated}\n\n[ETERE.md truncated: exceeded ${PROJECT_MEMORY_CAP_BYTES} bytes]`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/dispatch/project-memory.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/project-memory.ts server/domain/dispatch/project-memory.test.ts
git commit -m "feat(dispatch): add project-memory ETERE.md reader with size cap"
```

---

### Task 2: `assemble()` runtime-facts + project-memory injection

**Files:**
- Modify: `server/domain/dispatch/prompt-assembler.ts`
- Test: `server/domain/dispatch/prompt-assembler.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks (strings supplied by the caller).
- Produces:
  - `withRuntimeContext(systemInstruction: string, runtimeFacts?: string, projectMemory?: string): string`
  - `assemble(ctx, subAgent, parsedMessage, resolvedName, mcpTools?, materialSkills?, runtimeFacts?: string, projectMemory?: string): AssembledPrompt` (two new trailing optional params)
  - Section headers (exact strings): `# Runtime` and `# Project memory (ETERE.md)`. Injected **after** base/sub-agent instruction and **before** `# Active Skills`.

- [ ] **Step 1: Write the failing test**

Append to `server/domain/dispatch/prompt-assembler.test.ts` (inside the existing `describe('assemble', ...)` block):

```ts
  it('injects runtime facts and project memory before Active Skills', () => {
    const out = assemble(
      ctx, null, 'hi', null, [], [],
      'Current time (UTC): 2026-06-18T00:00:00Z\nActive model: fake:fake-1',
      '# ETERE.md — demo\nNotes.',
    );
    const s = out.systemInstruction;
    expect(s).toContain('# Runtime');
    expect(s).toContain('Active model: fake:fake-1');
    expect(s).toContain('# Project memory (ETERE.md)');
    expect(s).toContain('Notes.');
    // ordering: base < runtime < project memory < skills
    expect(s.indexOf('Base.')).toBeLessThan(s.indexOf('# Runtime'));
    expect(s.indexOf('# Runtime')).toBeLessThan(s.indexOf('# Project memory (ETERE.md)'));
    expect(s.indexOf('# Project memory (ETERE.md)')).toBeLessThan(s.indexOf('# Active Skills'));
  });

  it('omits runtime/project-memory sections when not provided', () => {
    const out = assemble(ctx, null, 'hi', null);
    expect(out.systemInstruction).not.toContain('# Runtime');
    expect(out.systemInstruction).not.toContain('# Project memory (ETERE.md)');
  });

  it('injects runtime context in the sub-agent branch too', () => {
    const out = assemble(
      ctx, sub, 'hi', 'designer', [], [],
      'Active model: fake:fake-1', '# ETERE.md\nNotes.',
    );
    const s = out.systemInstruction;
    expect(s).toContain('# Sub-agent: designer');
    expect(s.indexOf('# Sub-agent: designer')).toBeLessThan(s.indexOf('# Project memory (ETERE.md)'));
    expect(s.indexOf('# Project memory (ETERE.md)')).toBeLessThan(s.indexOf('# Active Skills'));
  });

  it('withRuntimeContext appends only the provided blocks', () => {
    expect(withRuntimeContext('Base.')).toBe('Base.');
    expect(withRuntimeContext('Base.', 'F')).toBe('Base.\n\n# Runtime\nF');
    expect(withRuntimeContext('Base.', undefined, 'M')).toBe('Base.\n\n# Project memory (ETERE.md)\nM');
  });
```

Add `withRuntimeContext` to the import at the top of the test file:

```ts
import { assemble, withRuntimeContext } from './prompt-assembler';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/dispatch/prompt-assembler.test.ts`
Expected: FAIL — `withRuntimeContext` is not exported; new assertions fail.

- [ ] **Step 3: Write minimal implementation**

In `server/domain/dispatch/prompt-assembler.ts`, add the helper above `assemble` (after `withSkillsBlock`):

```ts
const RUNTIME_HEADER = '# Runtime';
const PROJECT_MEMORY_HEADER = '# Project memory (ETERE.md)';

/**
 * Append a `# Runtime` facts block and/or a `# Project memory (ETERE.md)` block
 * to a system instruction. Each block is omitted when its string is empty/absent.
 * Pure string composition — the caller supplies already-read/built content.
 */
export function withRuntimeContext(
  systemInstruction: string,
  runtimeFacts?: string,
  projectMemory?: string,
): string {
  const parts = [systemInstruction.trim()];
  if (runtimeFacts && runtimeFacts.trim()) parts.push(`${RUNTIME_HEADER}\n${runtimeFacts.trim()}`);
  if (projectMemory && projectMemory.trim()) {
    parts.push(`${PROJECT_MEMORY_HEADER}\n${projectMemory.trim()}`);
  }
  return parts.filter(Boolean).join('\n\n');
}
```

Then change the `assemble` signature and both return branches. Replace the signature:

```ts
export function assemble(
  ctx: AetherContext,
  subAgent: SubAgentRecord | null,
  parsedMessage: string,
  resolvedName: string | null,
  mcpTools: ProviderToolDecl[] = [],
  materialSkills: PromptMaterialSkill[] = [],
  runtimeFacts?: string,
  projectMemory?: string,
): AssembledPrompt {
```

In the `if (!subAgent)` branch, replace the `systemInstruction:` line with:

```ts
      systemInstruction: withSkillsBlock(
        withRuntimeContext(ctx.systemInstruction, runtimeFacts, projectMemory),
        labels,
        materialSkills,
      ),
```

In the sub-agent branch, replace the `systemInstruction:` line with:

```ts
    systemInstruction: withSkillsBlock(
      withRuntimeContext(baseSys, runtimeFacts, projectMemory),
      labels,
      materialSkills,
    ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/dispatch/prompt-assembler.test.ts`
Expected: PASS (existing + 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/prompt-assembler.ts server/domain/dispatch/prompt-assembler.test.ts
git commit -m "feat(dispatch): inject runtime facts + project memory into assembled prompt"
```

---

### Task 3: `readRecord` populates `workspaceId`

The session→workspace anchor depends on `readRecord` returning `workspaceId`. The
query already selects `workspace_id` but the returned object drops it.

**Files:**
- Modify: `server/domain/history/history.store.ts:104-118` (the `readRecord` method)
- Test: `server/domain/history/history.store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `readRecord(id)` resolves with `workspaceId?: string` populated from the row (already part of the `SessionRecord` type at `history.types.ts:39`).

- [ ] **Step 1: Write the failing test**

Append to `server/domain/history/history.store.test.ts` (inside the top-level describe; reuse the file's existing store-construction helper — match how neighboring tests obtain a `HistoryStore`):

```ts
  it('readRecord returns the session workspaceId', async () => {
    const meta = await store.createEmpty({ workspaceId: 'ws-42' });
    const rec = await store.readRecord(meta.id);
    expect(rec?.workspaceId).toBe('ws-42');
  });

  it('readRecord leaves workspaceId undefined when unset', async () => {
    const meta = await store.createEmpty();
    const rec = await store.readRecord(meta.id);
    expect(rec?.workspaceId).toBeUndefined();
  });
```

> If the existing test file names its store variable differently (not `store`),
> rename these two snippets' `store` to match. Open the file first and reuse its
> setup; do not introduce a second DB harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/history/history.store.test.ts -t "workspaceId"`
Expected: FAIL — `rec.workspaceId` is `undefined` for the `ws-42` case.

- [ ] **Step 3: Write minimal implementation**

In `server/domain/history/history.store.ts`, in `readRecord`, add the field to the returned object (the row already selects `workspace_id`):

```ts
    return {
      title: row.title,
      createdAt: row.created_at,
      providerName: row.provider_name ?? undefined,
      workspaceId: row.workspace_id ?? undefined,
      messages,
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/history/history.store.test.ts -t "workspaceId"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/history/history.store.ts server/domain/history/history.store.test.ts
git commit -m "fix(history): readRecord returns workspaceId"
```

---

### Task 4: `DispatchService` resolves root, reads ETERE.md, injects on both paths

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts` (imports; `DispatchServiceDeps`; `handle()` ~L468-469; `resume()` ~L675-690)
- Test: `server/domain/dispatch/dispatch.service.test.ts`

**Interfaces:**
- Consumes: `readProjectMemory` (Task 1), `assemble`/`withRuntimeContext` (Task 2), `readRecord().workspaceId` (Task 3).
- Produces: `DispatchServiceDeps.projectRootFor?: (workspaceId: string | undefined) => string | null`. When present, `handle()` and `resume()` inject `# Runtime` (`Current time (UTC): <ISO>` + `Active model: <providerName>`) and `# Project memory (ETERE.md)` into the system instruction.

- [ ] **Step 1: Write the failing test**

Open `server/domain/dispatch/dispatch.service.test.ts` and reuse its existing
harness for building a `DispatchService` and capturing SSE. Add a focused test
that asserts the assembled system instruction (captured via the `assembled_prompt`
SSE event emitted in `aetherMode`, or via the existing harness's prompt capture —
match what the file already does) contains the project memory when
`projectRootFor` points at a dir holding `ETERE.md`:

```ts
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

it('injects ETERE.md from the session workspace root into the prompt', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'etere-dispatch-'));
  writeFileSync(path.join(root, 'ETERE.md'), '# ETERE.md — proj\nUSE NPM RUN DEV.');

  // Build the service with the file's existing helper, adding:
  //   projectRootFor: (wsId) => (wsId === 'ws-1' ? root : null)
  // and a session whose workspaceId is 'ws-1'.
  // Drive a dispatch in aetherMode:true so the assembled_prompt event fires.
  const events = await runDispatchCaptured({
    projectRootFor: (wsId: string | undefined) => (wsId === 'ws-1' ? root : null),
    sessionWorkspaceId: 'ws-1',
    aetherMode: true,
  });

  const prompt = events.find((e) => e.type === 'assembled_prompt')?.content ?? '';
  expect(prompt).toContain('# Project memory (ETERE.md)');
  expect(prompt).toContain('USE NPM RUN DEV.');
  expect(prompt).toContain('# Runtime');
  expect(prompt).toContain('Active model:');

  rmSync(root, { recursive: true, force: true });
});

it('omits project memory when the session has no workspace', async () => {
  const events = await runDispatchCaptured({
    projectRootFor: () => null,
    sessionWorkspaceId: undefined,
    aetherMode: true,
  });
  const prompt = events.find((e) => e.type === 'assembled_prompt')?.content ?? '';
  expect(prompt).not.toContain('# Project memory (ETERE.md)');
  expect(prompt).toContain('# Runtime'); // runtime facts always present
});
```

> `runDispatchCaptured` is pseudocode for the file's existing dispatch-driving
> helper. Open the test file FIRST and adapt these two cases to its real harness
> (how it constructs deps, seeds a session with a `workspaceId`, sets
> `aetherMode`, and collects SSE events). Do not invent a new harness. The
> `assembled_prompt` event's `content` is produced by `formatAssembledPromptContent`
> (`dispatch.service.ts:475`), so the system instruction text is present there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/dispatch/dispatch.service.test.ts -t "ETERE.md"`
Expected: FAIL — project memory not injected (`projectRootFor` not consumed yet).

- [ ] **Step 3: Write minimal implementation**

In `server/domain/dispatch/dispatch.service.ts`:

(a) Update imports (line ~18):

```ts
import { assemble, withRuntimeContext } from './prompt-assembler';
import { readProjectMemory } from './project-memory';
```

(b) Add the dep to `DispatchServiceDeps` (after `skillsService?` at ~L93):

```ts
  /** Resolve the project root for a session's workspace; null → no project memory. */
  projectRootFor?: (workspaceId: string | undefined) => string | null;
```

(c) Add a private helper method to the class (near other private helpers):

```ts
  private buildRuntimeFacts(providerName: string): string {
    return `Current time (UTC): ${new Date().toISOString()}\nActive model: ${providerName}`;
  }
```

(d) In `handle()`, replace the `assemble(...)` call (L468-469) with:

```ts
    const materialSkills = this.deps.skillsService?.getActiveForPrompt() ?? [];
    const projectMemory = readProjectMemory(
      this.deps.projectRootFor?.(sessionRecord?.workspaceId) ?? null,
    );
    const runtimeFacts = this.buildRuntimeFacts(providerName);
    const assembled = assemble(
      context, matchedSubAgent, effectiveStripped, mention.name,
      mcpToolDecls, materialSkills, runtimeFacts, projectMemory,
    );
```

(e) In `resume()`, the system instruction is `context.systemInstruction` used in
two places (the `aetherMode` tracer at ~L677 and `runDispatchLoop` at ~L685).
Compute it once after `context` is loaded and `providerName` is known:

```ts
    const resumeSystemInstruction = withRuntimeContext(
      context.systemInstruction,
      this.buildRuntimeFacts(providerName),
      readProjectMemory(this.deps.projectRootFor?.(sessionRecord.workspaceId) ?? null),
    );
```

Then use `resumeSystemInstruction` instead of `context.systemInstruction` in BOTH
the `formatAssembledPromptContent(...)` tracer call and the `runDispatchLoop({ systemInstruction: ... })` call.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/dispatch/dispatch.service.test.ts`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "feat(dispatch): inject per-workspace ETERE.md + runtime facts on handle and resume"
```

---

### Task 5: Wire `projectRootFor` in the composition root

**Files:**
- Modify: `server/index.ts` (the `new DispatchService({...})` call at ~L200)

**Interfaces:**
- Consumes: `DispatchServiceDeps.projectRootFor` (Task 4); `workspacesStore` (L86) and `builtinStore` (L71), both already constructed before the dispatcher.
- Produces: priority chain `workspace.rootPath` → filesystem MCP `fs_root` → `null`.

- [ ] **Step 1: Add the dep to the DispatchService construction**

In `server/index.ts`, in the `new DispatchService({ ... })` object (~L200-208), add:

```ts
    projectRootFor: (workspaceId) => {
      if (workspaceId) {
        const ws = workspacesStore.get(workspaceId);
        if (ws) return ws.rootPath;
      }
      return builtinStore.read().find((r) => r.transport === 'filesystem')?.fsRoot ?? null;
    },
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS (no type errors; `workspaceId` infers as `string | undefined`, return `string | null`).

- [ ] **Step 3: Verify the backend suite still passes**

Run: `npx vitest run --project backend`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat(dispatch): wire projectRootFor (workspace root → fs_root → null)"
```

---

### Task 6: Seed the `init` skill

**Files:**
- Create: `server/skills/defaults/init/SKILL.md`
- Test: `server/skills/defaults/init/SKILL.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` from `@/server/domain/skills/frontmatter` (`parseFrontmatter(md): Frontmatter` with `name`/`description`).
- Produces: a valid default skill named `init`, copied into the data dir by the existing `seedDefaultSkills` on boot, and into `dist/skills/defaults` by the build.

- [ ] **Step 1: Write the failing test**

Create `server/skills/defaults/init/SKILL.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '@/server/domain/skills/frontmatter';

describe('init default skill', () => {
  const md = readFileSync(path.join(__dirname, 'SKILL.md'), 'utf8');

  it('has valid frontmatter with name "init"', () => {
    const fm = parseFrontmatter(md);
    expect(fm.name).toBe('init');
    expect(fm.description && fm.description.length).toBeGreaterThan(20);
  });

  it('targets ETERE.md and stays provider-agnostic', () => {
    expect(md).toContain('ETERE.md');
    expect(md.toLowerCase()).not.toContain('claude');
    expect(md.toLowerCase()).not.toContain('anthropic');
  });

  it('documents the FIFO-5 version window and the runtime-facts copy rule', () => {
    expect(md).toContain('5');
    expect(md).toContain('Storico versioni');
    expect(md).toMatch(/Current time|Active model|Runtime/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/skills/defaults/init/SKILL.test.ts`
Expected: FAIL — `SKILL.md` does not exist.

- [ ] **Step 3: Create the skill**

Create `server/skills/defaults/init/SKILL.md`:

```markdown
---
name: init
description: Analyze the current workspace and write or update ETERE.md, Aether's project-memory file at the project root. Use when the user asks to initialize the project, generate ETERE.md, or document the codebase for future agents.
---

# Initialize project memory (ETERE.md)

Produce `ETERE.md` at the project root: a compact, durable brief that lets a
future agent become productive in this repo fast. Write it for an agent, not for
human onboarding — capture what is NOT obvious from a glance at the code.

## Process
1. **Explore before writing (read-only).** Survey the structure, the manifest
   (`package.json` or equivalent), the README, and how the project is built,
   tested, linted, and run. Note the architecture, the conventions, and the
   non-obvious gotchas.
2. **Locate the root.** Write `ETERE.md` at the root the filesystem tool is
   rooted at (the active workspace). One `ETERE.md` per project.
3. **Write the metadata header** (see below), copying `Current time` and
   `Active model` **verbatim** from the `# Runtime` block in your system prompt.
   Never invent the timestamp or the model id.
4. **Write the body**: what the project is; the canonical commands
   (build/test/lint/run); the architecture in brief; the conventions; the traps.
   Do not restate what is obvious from the code. Keep it tight.
5. **Regenerating?** If `ETERE.md` already exists, treat it as an update: keep the
   original `Creato` date, bump the version counter (`v2`, `v3`, …), and append a
   row to the version history. The version table is a **FIFO window of the last 5
   versions** — drop the oldest row(s) so at most 5 remain. The counter never
   resets, so the table may show e.g. `v3..v7`.

## Header layout
\`\`\`markdown
# ETERE.md — <project name>

> Aether project memory — generated automatically.
>
> - **Progetto:** <name, from the manifest or the directory>
> - **Creato:** <ISO timestamp, from the first generation>
> - **Modello generatore:** <latest version's model>
>
> #### Storico versioni (ultime 5)
> | Versione | Data | Modello |
> |---|---|---|
> | v1 | <ISO timestamp> | <transport:model> |
\`\`\`

## Rules
- Describe this as "Aether's project memory". Never reference a vendor or product.
- `Modello generatore` mirrors the most recent version row's model.
- Prefer accuracy over completeness: omit a section rather than guess.
```

> Note: the inner code fence in `SKILL.md` uses ```` ```markdown ```` — when
> creating the file, write real triple-backtick fences (the `\`\`\`` above is only
> escaped for this plan document).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/skills/defaults/init/SKILL.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Confirm the build copies the skill**

Verify `server/skills/defaults` → `dist/skills/defaults` is an existing build step
(see `skills.paths.ts:20-21` comment and `package.json` build). If `init/` is
copied by the same glob as `brainstorming/` and `skill-creator/` (directory-level
copy), no build change is needed.

Run: `grep -n "skills/defaults" package.json`
Expected: a copy step that includes the whole `defaults` dir (directory copy, not a per-skill list). If it lists skills individually, add `init` to it.

- [ ] **Step 6: Commit**

```bash
git add server/skills/defaults/init/SKILL.md server/skills/defaults/init/SKILL.test.ts
git commit -m "feat(skills): seed the init skill that writes ETERE.md"
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 2: Full test run with coverage**

Run: `npm run test:run`
Expected: PASS, including all new tests. Confirm coverage on `server/domain/**`
stays ≥ 80% (new files are well-covered by Tasks 1-2 and 6).

- [ ] **Step 3: Manual smoke (offline)**

Run: `AETHER_FAKE_PROVIDER=1 npm run dev`
Then, with the filesystem MCP enabled and rooted at this repo, ask the agent to
"inizializza il progetto / genera ETERE.md", approve the write gate, and confirm
`ETERE.md` appears at the root with the metadata header. Send a follow-up message
and confirm (in aether-mode thinking panel) the prompt now contains a
`# Project memory (ETERE.md)` section.

- [ ] **Step 4: Final commit (if smoke required any fixes)**

```bash
git add -A
git commit -m "test: verify ETERE.md init end-to-end"
```

---

## Self-Review

**Spec coverage:**
- Seeded `init` skill → Task 6. ✅
- ETERE.md at workspace root, one per workspace → Tasks 4-5 (root resolution) + 6 (skill writes there). ✅
- Auto-ingestion into system instruction → Tasks 1, 2, 4. ✅
- Anchor to session→workspace (not global `fs_root`) → Tasks 3, 4. ✅
- `fs_root` fallback → Task 5. ✅
- Runtime facts always injected (UTC time + `transport:model`) → Tasks 2, 4. ✅
- 32 KB cap + truncation → Task 1. ✅
- Header fields (project, Creato, model, version table) → Task 6. ✅
- FIFO-5 version window + monotonic counter → Task 6. ✅
- `assemble()` stays pure → Tasks 1, 2 (I/O in Task 4 only). ✅
- Both `handle()` and `resume()` → Task 4. ✅
- Provider-agnostic copy → Task 6 (test asserts no "claude"/"anthropic"). ✅
- Tests for assembler/reader/dispatch/seed → Tasks 1, 2, 4, 6. ✅

**Placeholder scan:** Test harness references in Task 4 (`runDispatchCaptured`) are
explicitly flagged as adapt-to-existing pseudocode with instructions to open the
real file first; all production code is complete. No TODO/TBD in shipped code.

**Type consistency:** `readProjectMemory(root: string | null): string | null`,
`projectRootFor: (workspaceId: string | undefined) => string | null`,
`withRuntimeContext(systemInstruction, runtimeFacts?, projectMemory?)`, and the two
new trailing `assemble` params are referenced identically across Tasks 1, 2, 4, 5.
Section headers `# Runtime` / `# Project memory (ETERE.md)` are identical in Task 2
(impl + test) and Task 4 (test). ✅
