# Transparent LLM Dialogue in the Thinking Panel — Design

Date: 2026-06-17
Status: Approved (design)

## Goal

Make the actual payload sent to the LLM visible in the right-hand "thinking" (reasoning) panel during a dispatch, so the user can see the system prompt, active skills, sub-agent instructions, and declared tools that Aether sends to the model. This realizes Aether's transparency thesis: the user should understand *how Aether (and CLIs like it) work* by watching the real dialogue, not a summary of it.

## Problem

The thinking panel is fed by `reasoning_step` SSE events from `ReasoningTracer` (`server/domain/reasoning/reasoning.tracer.ts`), rendered by `ReasoningStepCard`. Today the steps capture **metadata, not content**:

- `dispatch.service.ts:390` — `"loaded systemInstruction (N chars)"`
- `dispatch.service.ts:449` — `"systemInstruction +N chars, +N skills, +N tools"`

The fully assembled prompt actually sent to the provider (`assembled.systemInstruction`, built at `dispatch.service.ts:466`, which already fuses base system prompt + `# Active Skills` block + sub-agent instructions) and the declared tools (`assembled.mcpTools`) are **never surfaced verbatim**. So the panel shows that work happened, but not what was said to the model.

## Decisions (from brainstorming)

1. **Scope of payload:** system layer + tool declarations (option B). The system layer is `assembled.systemInstruction` verbatim; tools are name + description (not full JSON parameter schema — kept readable). History and user message are excluded (already visible in the central chat).
2. **Granularity:** a single step (option 1), faithful to what is actually sent — no per-layer reconstruction, no change to `assemble()`.
3. **Persistence:** live only (option A). The step is emitted via SSE and shown live, but NOT stored in `reasoningSteps` → no DB bloat, no privacy footprint in exported sessions. Reopening an old session does not show it.
4. **Gating — "Aether mode":** the step is gated by a user toggle labelled **"Aether mode"**, ON-controllable from the TopBar. The flag rides in the dispatch request body so the backend only emits the step when the mode is on (no wasted SSE payload when off). For now "Aether mode" governs *only* the assembled-prompt reasoning step; it is named and modelled as Aether's broader disclosure/transparency mode so it can govern more of that behaviour in future slices. Default: **off**.

## Architecture

The crux is separating "emit to the panel" from "persist into history". `ReasoningTracer` currently couples both: `step()` and `pushExternal()` push to `steps[]` (persisted via `finalSteps()`) **and** emit the SSE event.

Add a new method `emitEphemeral(partial)` that builds a full `ReasoningStep` (with `id` + `timestamp`) and **only** emits the SSE event — it does not push to `steps[]`. This isolates the persist/ephemeral decision to a single call site (which tracer method you call), keeping the tracer the sole authority over what becomes history.

The frontend receives it as an ordinary `reasoning_step` event and renders it; because the backend never persists it, it is absent on session reload — consistent with "live only".

## Components

### 1. New reasoning step type

`server/domain/reasoning/reasoning.types.ts` — add `'assembled_prompt'` to the `ReasoningStepType` union.
`src/types/reasoning.types.ts` — mirror the same addition on the frontend type.

### 2. Tracer: `emitEphemeral`

`server/domain/reasoning/reasoning.tracer.ts` — add:

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

It mirrors `pushExternal` but omits the `this.steps.push(step)` line. As a result the step never appears in `finalSteps()`.

### 3. Payload formatting + emission

A small pure helper formats the step content faithfully:

```text
<assembled.systemInstruction verbatim>

--- Tools declared to the model (N) ---
- <tool.name>: <tool.description>
- ...
```

When there are no tools, the `--- Tools declared ... (0) ---` line still appears (with no bullets) so the absence is explicit.

Emission points (both paths, for faithful transparency) — each gated by the `aetherMode` request flag (emit only when true):

- **Normal dispatch:** immediately after `assemble()` (`dispatch.service.ts:466`), before `runDispatchLoop`, using `assembled.systemInstruction` and `assembled.mcpTools`.
- **`resume()`:** the resume path sends `context.systemInstruction` directly (around `dispatch.service.ts:665`) without `assemble()`. Emit the step there too, using the system instruction and tool declarations actually sent on that path.

Step shape: `{ type: 'assembled_prompt', title: <i18n "Prompt sent to model">, content: <formatted payload> }`. No `tokens`/`durationMs` (it's not timed work).

### 4. Frontend rendering

`src/components/reasoning/ReasoningStepCard.tsx`:

- Add `assembled_prompt` to `TYPE_LABELS` (label: `prompt`) and `TYPE_COLORS` (`bg-disclosure/10 text-disclosure`).
- Collapsed by default, like `tool_call`: change the initial open state to `useState(step.type !== 'tool_call' && step.type !== 'assembled_prompt')`.
- Wrap the `content` for this type in a scrollable container (`max-h-64 overflow-y-auto`, monospace) so a long verbatim payload stays readable without dominating the panel. Other types keep their current rendering.

`src/i18n/en.ts` (and `it` if present) — add the title string.

### 5. "Aether mode" toggle + request plumbing

**State** — `src/stores/ui.store.ts`: add `aetherMode: boolean` following the existing `thinkingEnabled` pattern exactly — `AETHER_MODE_KEY = 'aether.aetherMode'`, `readBool`/`writeBool`, `setAetherMode(v)` + `toggleAetherMode()`, default **off**, hydrated in `initFromStorage()`.

**Control** — TopBar component: a labelled toggle **"Aether mode"** bound to `aetherMode` / `toggleAetherMode`, placed near the existing controls (provider selector / thinking toggle). Matches existing TopBar control styling.

**Request flag** — `src/lib/api/dispatch.api.ts`: add optional `aetherMode?: boolean` to both `DispatchRequestBody` and `ResumeRequestBody`. `src/hooks/useStreamingDispatch.ts`: read `useUiStore.getState().aetherMode` and include it in the dispatch and resume bodies, mirroring how `thinking` is read and passed today (`useStreamingDispatch.ts:64,94`).

**Backend wiring** — the dispatch and resume route request schemas accept `aetherMode?: boolean` (default false); `DispatchService.handle()` / `resume()` receive it and pass it to the emission helper as the gate. When false (or absent), the `assembled_prompt` step is not emitted at all.

## Testing

**Backend**
- `reasoning.tracer.test.ts`: `emitEphemeral` emits a `reasoning_step` SSE event but the step is absent from `finalSteps()`.
- `dispatch.service.test.ts`: with `aetherMode: true`, a dispatch emits an `assembled_prompt` step whose `content` contains the verbatim system instruction and the tool-declaration header; the step is NOT present in the persisted model message's `reasoningSteps`. With `aetherMode` false/absent, no `assembled_prompt` step is emitted.

**Frontend**
- `ReasoningStepCard` test: with `type: 'assembled_prompt'`, the card is collapsed by default and reveals the verbatim content on expand.
- `ui.store` test: `toggleAetherMode`/`setAetherMode` persist to `localStorage` and `initFromStorage` hydrates the flag (mirrors the existing `thinkingEnabled` tests).

## Out of scope (future slices)

- Per-layer breakdown (separate steps for base prompt / skills / sub-agent / tools) — would require `assemble()` to return the distinct pieces.
- Showing full JSON parameter schemas for tools.
- Persisting the payload (or a hash/summary) for historical review.
- Extending "Aether mode" to govern additional disclosure/transparency behaviour beyond the assembled-prompt step (intended future direction, but this slice wires it to that one step only).
