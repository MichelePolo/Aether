# Transparent LLM Dialogue ("Aether mode") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the verbatim system layer + declared tools sent to the LLM as a live-only reasoning step in the thinking panel, gated by a TopBar "Aether mode" toggle.

**Architecture:** A new `ReasoningTracer.emitEphemeral` emits a `reasoning_step` SSE event without persisting it. A pure formatter renders the verbatim `assembled.systemInstruction` plus a tool-declaration list into the step content. Dispatch/resume emit this `assembled_prompt` step only when an `aetherMode` request flag is true. The flag is a `ui.store` boolean (default off), toggled from the TopBar and threaded into the dispatch/resume request bodies.

**Tech Stack:** TypeScript, Express, Zod, better-sqlite3, React 19 + Zustand, Vitest (backend `node` + frontend `jsdom` projects).

## Global Constraints

- "Aether mode" default: **off**. localStorage key: `aether.aetherMode`.
- The `assembled_prompt` step is **live only** — never pushed to `tracer.steps[]`, never in `finalSteps()`, never persisted to the DB.
- Backend gating: when `aetherMode` is false/absent the step is **not emitted at all** (no SSE payload).
- Step content is **verbatim** `assembled.systemInstruction` (no reconstruction); tools shown as `qualifiedName: description` only (no JSON schema).
- Run backend tests: `npx vitest run --project backend <file>`. Frontend: `npx vitest run --project frontend <file>`. Lint: `npm run lint` (`tsc --noEmit`).

---

### Task 1: New step type + `emitEphemeral`

**Files:**
- Modify: `server/domain/reasoning/reasoning.types.ts:1-9`
- Modify: `src/types/reasoning.types.ts` (mirror the union)
- Modify: `server/domain/reasoning/reasoning.tracer.ts`
- Test: `server/domain/reasoning/reasoning.tracer.test.ts`

**Interfaces:**
- Produces: `ReasoningTracer.emitEphemeral(partial: Omit<ReasoningStep, 'id' | 'timestamp'>): void` — emits SSE only, never persists. `'assembled_prompt'` added to `ReasoningStepType` (backend + frontend).

- [ ] **Step 1: Write the failing test**

Add to `server/domain/reasoning/reasoning.tracer.test.ts` (follow the existing SSE-capture pattern in that file; if the file builds a fake `SseEmitter`, reuse it — otherwise use this self-contained version):

```typescript
it('emitEphemeral emits an SSE reasoning_step but does not persist it', () => {
  const events: Array<{ name: string; data: unknown }> = [];
  const sse = { event: (name: string, data: unknown) => events.push({ name, data }) } as never;
  const tracer = new ReasoningTracer(sse);

  tracer.emitEphemeral({
    type: 'assembled_prompt',
    title: 'Prompt sent to model',
    content: 'SYSTEM…',
  });

  expect(events).toHaveLength(1);
  expect(events[0].name).toBe('reasoning_step');
  expect((events[0].data as { type: string }).type).toBe('assembled_prompt');
  expect(tracer.finalSteps()).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/reasoning/reasoning.tracer.test.ts -t "emitEphemeral"`
Expected: FAIL — `emitEphemeral` is not a function / `'assembled_prompt'` not assignable to `ReasoningStepType`.

- [ ] **Step 3: Add the step type (backend + frontend)**

In `server/domain/reasoning/reasoning.types.ts`, add `'assembled_prompt'` to the union:

```typescript
export type ReasoningStepType =
  | 'context_fetch'
  | 'mcp_query'
  | 'dispatch'
  | 'thinking'
  | 'validation'
  | 'logic'
  | 'resolve_subagent'
  | 'tool_call'
  | 'assembled_prompt';
```

Apply the identical addition to the `ReasoningStepType` union in `src/types/reasoning.types.ts`.

- [ ] **Step 4: Add `emitEphemeral` to the tracer**

In `server/domain/reasoning/reasoning.tracer.ts`, add this method to the `ReasoningTracer` class (next to `pushExternal`):

```typescript
  emitEphemeral(partial: Omit<ReasoningStep, 'id' | 'timestamp'>): void {
    const step: ReasoningStep = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...partial,
    };
    this.sse.event('reasoning_step', step);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project backend server/domain/reasoning/reasoning.tracer.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/domain/reasoning/reasoning.types.ts src/types/reasoning.types.ts server/domain/reasoning/reasoning.tracer.ts server/domain/reasoning/reasoning.tracer.test.ts
git commit -m "feat(reasoning): add assembled_prompt step type and emitEphemeral"
```

---

### Task 2: Assembled-prompt content formatter

**Files:**
- Create: `server/domain/dispatch/assembled-prompt-step.ts`
- Test: `server/domain/dispatch/assembled-prompt-step.test.ts`

**Interfaces:**
- Consumes: `ProviderToolDecl` from `./providers/provider.types` (`{ qualifiedName: string; description?: string; schema: {...} }`).
- Produces: `formatAssembledPromptContent(systemInstruction: string, tools: ProviderToolDecl[]): string`.

- [ ] **Step 1: Write the failing test**

Create `server/domain/dispatch/assembled-prompt-step.test.ts`:

```typescript
import { formatAssembledPromptContent } from './assembled-prompt-step';
import type { ProviderToolDecl } from './providers/provider.types';

describe('formatAssembledPromptContent', () => {
  it('includes the verbatim system instruction and a tool list', () => {
    const tools: ProviderToolDecl[] = [
      { qualifiedName: 'mcp__fs__read', description: 'Read a file', schema: { type: 'object' } },
      { qualifiedName: 'mcp__fs__write', schema: { type: 'object' } },
    ];
    const out = formatAssembledPromptContent('SYSTEM PROMPT VERBATIM', tools);
    expect(out).toContain('SYSTEM PROMPT VERBATIM');
    expect(out).toContain('--- Tools declared to the model (2) ---');
    expect(out).toContain('- mcp__fs__read: Read a file');
    expect(out).toContain('- mcp__fs__write: (no description)');
  });

  it('renders the header with zero tools and no bullets', () => {
    const out = formatAssembledPromptContent('SYS', []);
    expect(out).toContain('--- Tools declared to the model (0) ---');
    expect(out).not.toContain('\n- ');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/dispatch/assembled-prompt-step.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the formatter**

Create `server/domain/dispatch/assembled-prompt-step.ts`:

```typescript
import type { ProviderToolDecl } from './providers/provider.types';

/**
 * Renders the verbatim payload sent to the LLM (system layer + declared tools)
 * for the live-only `assembled_prompt` reasoning step. The system instruction is
 * copied verbatim; tools are listed as `qualifiedName: description` only.
 */
export function formatAssembledPromptContent(
  systemInstruction: string,
  tools: ProviderToolDecl[],
): string {
  const header = `--- Tools declared to the model (${tools.length}) ---`;
  const lines = tools.map((t) => `- ${t.qualifiedName}: ${t.description ?? '(no description)'}`);
  return [systemInstruction.trim(), '', header, ...lines].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/domain/dispatch/assembled-prompt-step.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/assembled-prompt-step.ts server/domain/dispatch/assembled-prompt-step.test.ts
git commit -m "feat(dispatch): add assembled-prompt content formatter"
```

---

### Task 3: Backend gating + emission (dispatch + resume)

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts:33-47` (schemas), `:353` (handle destructure + emit after assemble at `:466`), `:576-581` (resume opts + emit before runDispatchLoop at `:662`)
- Modify: `server/routes/dispatch.routes.ts:42-46` (thread `aetherMode` into resume opts)
- Test: `server/domain/dispatch/dispatch.service.test.ts`

**Interfaces:**
- Consumes: `formatAssembledPromptContent` (Task 2), `tracer.emitEphemeral` (Task 1).
- Produces: `DispatchRequestSchema` and `ResumeRequestSchema` accept `aetherMode?: boolean`; `resume(opts: { …; aetherMode?: boolean })`.

- [ ] **Step 1: Write the failing test**

Add to `server/domain/dispatch/dispatch.service.test.ts` (reuse the file's existing harness that builds a `DispatchService` with a fake provider and captures SSE events — model these two tests on the nearest existing `handle()` test in that file, substituting the assertions below):

```typescript
it('emits a live-only assembled_prompt step when aetherMode is on', async () => {
  // ...arrange a dispatch exactly like the existing handle() test, but pass
  // aetherMode: true in the request body...
  const promptEvents = sseEvents.filter(
    (e) => e.name === 'reasoning_step' && (e.data as { type: string }).type === 'assembled_prompt',
  );
  expect(promptEvents).toHaveLength(1);
  expect((promptEvents[0].data as { content: string }).content).toContain('You are Aether');
  expect((promptEvents[0].data as { content: string }).content).toContain('Tools declared to the model');

  // Live only: not in the persisted model message.
  const saved = await historyStore.readRecord(sessionId);
  const modelMsg = saved!.messages.find((m) => m.role === 'model')!;
  expect((modelMsg.reasoningSteps ?? []).some((s) => s.type === 'assembled_prompt')).toBe(false);
});

it('does not emit an assembled_prompt step when aetherMode is off', async () => {
  // ...same dispatch but omit aetherMode (or set false)...
  const promptEvents = sseEvents.filter(
    (e) => e.name === 'reasoning_step' && (e.data as { type: string }).type === 'assembled_prompt',
  );
  expect(promptEvents).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/dispatch/dispatch.service.test.ts -t "assembled_prompt"`
Expected: FAIL — no `assembled_prompt` event emitted.

- [ ] **Step 3: Add `aetherMode` to the schemas**

In `server/domain/dispatch/dispatch.service.ts`, add the field to both schemas:

```typescript
export const DispatchRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  thinking: z.boolean().optional(),
  aetherMode: z.boolean().optional(),
  providerName: z.string().optional(),
  attachments: z.array(DispatchAttachmentSchema).max(MAX_ATTACHMENTS).optional(),
});
```

```typescript
export const ResumeRequestSchema = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  providerName: z.string().optional(),
  aetherMode: z.boolean().optional(),
});
```

- [ ] **Step 4: Emit the step in `handle()`**

Add the import at the top of `dispatch.service.ts` (next to the `assemble` import):

```typescript
import { formatAssembledPromptContent } from './assembled-prompt-step';
```

Change the destructure at `:353`:

```typescript
    const { sessionId, message, thinking, aetherMode } = parsed.data;
```

Immediately after `const assembled = assemble(...)` (`:466`), before building attachments, insert:

```typescript
    if (aetherMode) {
      tracer.emitEphemeral({
        type: 'assembled_prompt',
        title: 'Prompt sent to model',
        content: formatAssembledPromptContent(assembled.systemInstruction, assembled.mcpTools),
      });
    }
```

- [ ] **Step 5: Emit the step in `resume()` and thread the flag**

Change the `resume` signature (`:576-580`):

```typescript
  async resume(
    opts: { sessionId: string; messageId: string; providerName?: string; aetherMode?: boolean },
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void> {
```

Immediately after `mcpToolDecls` is built (`:659`) and before `const loopResult = await this.runDispatchLoop(` (`:662`), insert:

```typescript
    if (opts.aetherMode) {
      tracer.emitEphemeral({
        type: 'assembled_prompt',
        title: 'Prompt sent to model',
        content: formatAssembledPromptContent(context.systemInstruction, mcpToolDecls),
      });
    }
```

In `server/routes/dispatch.routes.ts`, thread the flag into the resume opts (the resume handler reads `req.body` manually around `:42-46`):

```typescript
      await dispatcher.resume(
        {
          sessionId: body.sessionId,
          messageId: body.messageId,
          providerName: body.providerName as string | undefined,
          aetherMode: (req.body as { aetherMode?: boolean }).aetherMode === true,
        },
        sse,
        controller.signal,
      );
```

(`handle()` reads `req.body` straight into `DispatchRequestSchema`, so no route change is needed for the dispatch path.)

- [ ] **Step 6: Run the tests + lint**

Run: `npx vitest run --project backend server/domain/dispatch/dispatch.service.test.ts && npm run lint`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/routes/dispatch.routes.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "feat(dispatch): emit live-only assembled_prompt step gated by aetherMode"
```

---

### Task 4: `ui.store` Aether mode flag

**Files:**
- Modify: `src/stores/ui.store.ts`
- Test: `src/stores/ui.store.test.ts` (create if absent; otherwise add to it)

**Interfaces:**
- Produces: `useUiStore` gains `aetherMode: boolean`, `setAetherMode(v: boolean): void`, `toggleAetherMode(): void`; hydrated in `initFromStorage()`. localStorage key `aether.aetherMode`, default off.

- [ ] **Step 1: Write the failing test**

Add to `src/stores/ui.store.test.ts`:

```typescript
import { useUiStore } from './ui.store';

describe('ui.store aetherMode', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState()._reset();
  });

  it('defaults off and toggles + persists', () => {
    expect(useUiStore.getState().aetherMode).toBe(false);
    useUiStore.getState().toggleAetherMode();
    expect(useUiStore.getState().aetherMode).toBe(true);
    expect(localStorage.getItem('aether.aetherMode')).toBe('1');
  });

  it('hydrates from storage via initFromStorage', () => {
    localStorage.setItem('aether.aetherMode', '1');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().aetherMode).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project frontend src/stores/ui.store.test.ts -t "aetherMode"`
Expected: FAIL — `aetherMode` undefined / `toggleAetherMode` not a function.

- [ ] **Step 3: Implement the flag**

In `src/stores/ui.store.ts`:

Add the key constant near the others (`:6-9`):

```typescript
const AETHER_MODE_KEY = 'aether.aetherMode';
```

Add to the `UiState` interface (near `thinkingEnabled`):

```typescript
  aetherMode: boolean;
  setAetherMode: (v: boolean) => void;
  toggleAetherMode: () => void;
```

Add to the `initial` object (`:83-104`):

```typescript
  aetherMode: false,
```

Add the actions in the store body (next to `toggleThinking`):

```typescript
  setAetherMode: (v) => {
    writeBool(AETHER_MODE_KEY, v);
    set({ aetherMode: v });
  },
  toggleAetherMode: () => {
    const next = !get().aetherMode;
    writeBool(AETHER_MODE_KEY, next);
    set({ aetherMode: next });
  },
```

Add to the `initFromStorage()` set object (`:223-232`):

```typescript
      aetherMode: readBool(AETHER_MODE_KEY, false),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project frontend src/stores/ui.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/ui.store.ts src/stores/ui.store.test.ts
git commit -m "feat(ui): add Aether mode flag to ui.store"
```

---

### Task 5: Request plumbing (api body + dispatch hook)

**Files:**
- Modify: `src/lib/api/dispatch.api.ts:3-13` (DispatchRequestBody), `:33-37` (ResumeRequestBody)
- Modify: `src/hooks/useStreamingDispatch.ts:64,94` (dispatch body) and the resume body site

**Interfaces:**
- Consumes: `useUiStore.getState().aetherMode` (Task 4).
- Produces: `aetherMode?: boolean` on `DispatchRequestBody` and `ResumeRequestBody`, populated from the store.

- [ ] **Step 1: Add the field to both request bodies**

In `src/lib/api/dispatch.api.ts`, add `aetherMode?: boolean;` to `DispatchRequestBody` (after `thinking?`) and to `ResumeRequestBody`:

```typescript
export interface DispatchRequestBody {
  sessionId: string;
  message: string;
  thinking?: boolean;
  aetherMode?: boolean;
  providerName?: string;
  attachments?: Array<{ name: string; mime: string; size: number; contentBase64: string }>;
}
```

```typescript
export interface ResumeRequestBody {
  sessionId: string;
  messageId: string;
  providerName?: string;
  aetherMode?: boolean;
}
```

- [ ] **Step 2: Populate it in the dispatch hook**

In `src/hooks/useStreamingDispatch.ts`, where `thinking` is read (`:64`) add:

```typescript
    const aetherMode = useUiStore.getState().aetherMode;
```

and include `aetherMode` in the dispatch request body (next to `thinking,` at `:94`). Find the resume call in the same hook and add `aetherMode` to its body object too.

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: no type errors.

- [ ] **Step 4: Run the dispatch hook tests (regression)**

Run: `npx vitest run --project frontend src/hooks/useStreamingDispatch.test.ts`
Expected: PASS (existing tests unaffected; flag is optional).

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/dispatch.api.ts src/hooks/useStreamingDispatch.ts
git commit -m "feat(ui): thread aetherMode into dispatch and resume requests"
```

---

### Task 6: TopBar "Aether mode" toggle

**Files:**
- Modify: `src/components/layout/TopBar.tsx`
- Test: `src/components/layout/TopBar.test.tsx`

**Interfaces:**
- Consumes: `useUiStore` `aetherMode` + `toggleAetherMode` (Task 4); `IconButton` (existing).

- [ ] **Step 1: Write the failing test**

Add to `src/components/layout/TopBar.test.tsx` (mirror the existing render setup in that file):

```typescript
it('renders an Aether mode toggle that flips the store flag', async () => {
  const user = userEvent.setup();
  render(<TopBar title="t" sidebarOpen onToggleSidebar={() => {}} />);
  const btn = screen.getByRole('button', { name: 'Aether mode' });
  expect(useUiStore.getState().aetherMode).toBe(false);
  await user.click(btn);
  expect(useUiStore.getState().aetherMode).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project frontend src/components/layout/TopBar.test.tsx -t "Aether mode"`
Expected: FAIL — no button named "Aether mode".

- [ ] **Step 3: Add the toggle**

In `src/components/layout/TopBar.tsx`, import the icon and store actions, then add the toggle button. Add `Eye` to the lucide import:

```typescript
import { GitBranch, MessageSquare, Eye } from 'lucide-react';
```

Read the state inside the component (next to the other `useUiStore` selectors):

```typescript
  const aetherMode = useUiStore((s) => s.aetherMode);
  const toggleAetherMode = useUiStore((s) => s.toggleAetherMode);
```

Add the button in the header (next to the command-palette button), using the existing `IconButton`:

```tsx
      <IconButton
        label="Aether mode"
        onClick={toggleAetherMode}
        variant={aetherMode ? 'active' : 'default'}
      >
        <Eye size={14} aria-hidden="true" />
      </IconButton>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project frontend src/components/layout/TopBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/TopBar.tsx src/components/layout/TopBar.test.tsx
git commit -m "feat(ui): add Aether mode toggle to the TopBar"
```

---

### Task 7: ReasoningStepCard rendering for `assembled_prompt`

**Files:**
- Modify: `src/components/reasoning/ReasoningStepCard.tsx:8-28` (labels/colors), `:50` (default-open), `:74-78` (content render)
- Test: `src/components/reasoning/ReasoningStepCard.test.tsx` (create if absent; otherwise add)

**Interfaces:**
- Consumes: `ReasoningStep` with `type: 'assembled_prompt'` (Task 1).

- [ ] **Step 1: Write the failing test**

Add to `src/components/reasoning/ReasoningStepCard.test.tsx`:

```typescript
it('renders assembled_prompt collapsed, revealing verbatim content on expand', async () => {
  const user = userEvent.setup();
  const step = {
    id: '1', type: 'assembled_prompt' as const, title: 'Prompt sent to model',
    content: 'You are Aether VERBATIM', timestamp: 0,
  };
  render(<ReasoningStepCard step={step} />);
  expect(screen.queryByText('You are Aether VERBATIM')).toBeNull(); // collapsed
  await user.click(screen.getByRole('button', { name: /Prompt sent to model/ }));
  expect(screen.getByText('You are Aether VERBATIM')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project frontend src/components/reasoning/ReasoningStepCard.test.tsx -t "assembled_prompt"`
Expected: FAIL — content is visible by default (unknown type falls back to `logic`, which is expanded).

- [ ] **Step 3: Add label, color, default-collapse, scroll**

In `src/components/reasoning/ReasoningStepCard.tsx`:

Add to `TYPE_LABELS` (`:8-17`): `assembled_prompt: 'prompt',`
Add to `TYPE_COLORS` (`:19-28`): `assembled_prompt: 'bg-disclosure/10 text-disclosure',`

Change the default-open line (`:50`):

```typescript
  const [open, setOpen] = useState(step.type !== 'tool_call' && step.type !== 'assembled_prompt');
```

Wrap the content render (`:76-78`) so `assembled_prompt` is scrollable + monospace:

```tsx
          {step.content && (
            <div
              className={cn(
                'text-[11px] text-zinc-400 whitespace-pre-wrap mb-2',
                step.type === 'assembled_prompt' && 'max-h-64 overflow-y-auto font-mono bg-zinc-900/60 rounded p-1.5',
              )}
            >
              {step.content}
            </div>
          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project frontend src/components/reasoning/ReasoningStepCard.test.tsx && npm run lint`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/reasoning/ReasoningStepCard.tsx src/components/reasoning/ReasoningStepCard.test.tsx
git commit -m "feat(reasoning): render assembled_prompt step collapsed and scrollable"
```

---

## Self-Review

**Spec coverage:**
- Step type + `emitEphemeral` (live-only) → Task 1. ✓
- System layer verbatim + tool declarations (name+description) → Task 2 formatter. ✓
- Emission in dispatch + resume, gated by `aetherMode` → Task 3. ✓
- Not persisted (absent from `reasoningSteps`) → asserted in Task 3 Step 1. ✓
- "Aether mode" toggle in TopBar, ui.store, default off, request flag, backend gating → Tasks 4, 5, 6. ✓
- Frontend rendering collapsed + scrollable → Task 7. ✓
- Tests (tracer, dispatch on/off, ui.store, card) → Tasks 1,3,4,7. ✓

**Placeholder scan:** Task 3 Step 1 deliberately reuses "the existing handle() test harness" rather than inventing a fake DispatchService wiring (the real harness is non-trivial and lives in the test file); the assertions are concrete. All code steps show full code. No TBD/TODO. ✓

**Type consistency:** `emitEphemeral`, `formatAssembledPromptContent(systemInstruction, tools)`, `aetherMode`, step type `'assembled_prompt'`, title `'Prompt sent to model'`, key `'aether.aetherMode'` are used identically across all tasks. ✓

**Note on i18n:** The reasoning-step `title` is produced backend-side (no frontend i18n), and the toggle uses a literal `label` like the existing `IconButton`s ("Toggle sidebar"), so no `src/i18n` change is required — a deliberate simplification from the spec's tentative i18n mention.
