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
3. **Persistence:** persisted with the model message (REVISED — was originally "live only"). The step is emitted via SSE *and* recorded in the message's `reasoningSteps` (via `tracer.pushExternal`), so it survives reload. Persistence is bounded by the `aetherMode` gate: nothing is stored when the mode is off (default). **Why revised:** the live-only approach made the step vanish the instant the model replied — the frontend finalizes a streamed message by replacing its steps with the backend's authoritative `finalSteps()` list, which (by design) excluded the ephemeral step. Persisting fixes this structurally instead of via a frontend merge, at the cost of ~2-4 KB per model message *only when Aether mode is on*. `reasoningSteps` is already a JSON column, so no migration is needed.
4. **Gating — "Aether mode":** the step is gated by a user toggle labelled **"Aether mode"**, ON-controllable from the TopBar. The flag rides in the dispatch request body so the backend only emits the step when the mode is on (no wasted SSE payload when off). For now "Aether mode" governs *only* the assembled-prompt reasoning step; it is named and modelled as Aether's broader disclosure/transparency mode so it can govern more of that behaviour in future slices. Default: **off**.

## Architecture

The `assembled_prompt` step is emitted through the existing `ReasoningTracer.pushExternal(partial)`, which both pushes the step to `steps[]` (persisted via `finalSteps()` into the model message's `reasoningSteps`) **and** emits the SSE event. The frontend receives it as an ordinary `reasoning_step` event and renders it live; on completion the persisted list still contains it, so it stays visible and survives reload.

(An earlier revision added a separate `emitEphemeral` method that emitted without persisting; it was removed when the persistence decision changed, since `pushExternal` already does exactly what is needed.)

## Components

### 1. New reasoning step type

`server/domain/reasoning/reasoning.types.ts` — add `'assembled_prompt'` to the `ReasoningStepType` union.
`src/types/reasoning.types.ts` — mirror the same addition on the frontend type.

### 2. Tracer

No new tracer method is needed — the step uses the existing `pushExternal`, which both records the step in `steps[]` (so it is persisted via `finalSteps()`) and emits the `reasoning_step` SSE event.

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
- `dispatch.service.test.ts`: with `aetherMode: true`, a dispatch emits an `assembled_prompt` step whose `content` contains the verbatim system instruction and the tool-declaration header, and the step IS present in the persisted model message's `reasoningSteps` (survives reload). With `aetherMode` false/absent, no `assembled_prompt` step is emitted.

**Frontend**
- `ReasoningStepCard` test: with `type: 'assembled_prompt'`, the card is collapsed by default and reveals the verbatim content on expand.
- `ui.store` test: `toggleAetherMode`/`setAetherMode` persist to `localStorage` and `initFromStorage` hydrates the flag (mirrors the existing `thinkingEnabled` tests).

## Out of scope (future slices)

- Per-layer breakdown (separate steps for base prompt / skills / sub-agent / tools) — would require `assemble()` to return the distinct pieces.
- Showing full JSON parameter schemas for tools.
- Deduplicating the persisted payload across turns (the system prompt is largely stable; a future optimization could store it once per session instead of per message).
- Extending "Aether mode" to govern additional disclosure/transparency behaviour beyond the assembled-prompt step (intended future direction, but this slice wires it to that one step only).
