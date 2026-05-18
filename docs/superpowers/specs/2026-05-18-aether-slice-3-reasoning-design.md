# Aether Slice 3 — Real Reasoning Steps + Gemini Thinking

**Date:** 2026-05-18
**Status:** Approved (brainstorming phase)
**Owner:** Michele
**Reference specs:**
- `docs/superpowers/specs/2026-05-17-aether-rewrite-design.md`
- `docs/superpowers/specs/2026-05-18-aether-slice-2a-chat-streaming-design.md`
- `docs/superpowers/specs/2026-05-18-aether-slice-2b-multi-session-design.md`

## Goal

Sostituire i reasoning steps mock dell'ex-prototipo con un tracer reale che emette step strutturati durante la pipeline di dispatch e cattura i thoughts del modello Gemini quando il toggle "thinking" è attivo:

1. **`ReasoningTracer`** lato server con `step(type, run)` (timing automatico + emit SSE live) e `pushExternal()` per step esterni (es. thoughts accumulati cross-chunk).
2. **Toggle "thinking"** per-richiesta: `POST /api/ai/dispatch` accetta `thinking?: boolean`. Quando `true`, il `GeminiProvider` imposta `thinkingConfig` e `includeThoughts` e distingue thought parts da answer parts.
3. **SSE events nuovi**: `reasoning_step` (per ogni step concluso dal tracer) e `thinking` (chunk-by-chunk durante lo stream). `done` ora include `reasoningSteps[]`.
4. **`Message.reasoningSteps?: ReasoningStep[]`** persistito in `data/sessions.json` insieme al messaggio model; sopravvive a reload e session switch.
5. **Frontend**: nuovo `useUiStore` per `reasoningDrawerOpen` + `thinkingEnabled` (persistito localStorage) + `focusedMessageId`. `useChatStore` estesa con `currentReasoning` live. Nuova drawer side-panel `ReasoningDrawer` che mostra: durante streaming → live thinking + step accumulati; dopo done → `Message.reasoningSteps[]` del focused/last assistant message.
6. **UI signaling**: badge `💭 thinking…` nel bubble durante streaming (quando ci sono thoughts live); `🧠 N steps` cliccabile dopo done. `MessageInput` ha un brain-icon toggle che riflette `useUiStore.thinkingEnabled`.
7. **Metrics**: `durationMs` sempre misurato (server-side via `performance.now()`); `tokens` valorizzato quando Gemini espone `usageMetadata.totalTokenCount`; `confidence` intenzionalmente omesso (nessun provider lo espone).

## Non-goals (in 3)

- `thinkingBudget` configurabile dall'utente (slider).
- `mcp_query` step (slice 7).
- `logic` step (no current source).
- `subAgent` valorizzato (slice 6).
- `confidence` numerico (nessun provider lo fornisce; `ConfidenceBar` creato ma renderizza null).
- Reasoning step in file separato (resta dentro `Message` in `sessions.json`).
- Detection automatica del modello "thinking-capable" (se utente abilita thinking ma il modello non lo supporta, semplicemente non si vedono thoughts — UX degradata ma non rotta).
- Token batching o backpressure per thinking chunks lunghissimi.
- Reasoning view alternative (drawer è l'unica modalità).

## Design decisions (brainstorming outcome)

| Decision | Choice | Reasoning |
|---|---|---|
| Thinking toggle | Per-request body flag `thinking?: boolean` | Massimo controllo, scope minimo. Persistito in localStorage via `useUiStore.thinkingEnabled` (il flag viene letto al momento del send). |
| Tracer step types in slice 3 | `context_fetch`, `dispatch`, `thinking`, `validation` | Quattro step concreti, dati reali. `mcp_query`/`logic`/`subAgent` reserved per slice future. |
| `validation` step | Step finale sempre emesso, carries `tokens` totali e success/length info | Non è "fake": rappresenta il post-stream check e raccoglie le metriche aggregate. |
| Drawer placement | Right-side fixed overlay, toggleable | Pattern dev-tools: separato dal flusso conversazionale, sempre disponibile, non spinge la chat. |
| Drawer auto-open | Apre automaticamente al primo `event:thinking` ricevuto | UX immediata quando i thoughts iniziano. L'utente può chiuderlo e riaprirlo a piacere. |
| Live thinking badge | `💭 thinking…` nel bubble durante stream quando `currentReasoning.thinkingText > 0` | Segnalazione discreta, senza overlay invasivi. |
| Post-stream badge | `🧠 N steps` nel bubble quando `message.reasoningSteps.length > 0` | Click apre il drawer focalizzato sul quel messaggio. |
| Metrics | `durationMs` sempre, `tokens` da Gemini `usageMetadata`, `confidence` omesso | Onestà: misuriamo solo ciò che possiamo misurare. `confidence` è ready-for-future. |
| Tracer pattern | `ReasoningTracer` classe stateful con `step()` + `pushExternal()` | Encapsulation pulita, timing automatico, pattern simile a `SseEmitter`. |
| Persistenza | `Message.reasoningSteps?` opzionale dentro `sessions.json` | Niente file separato (YAGNI). Backward-compat con messaggi 2a/2b senza reasoning. |
| Schema validation client-side | Non validiamo via zod sul client | Resilience a backend evolution: nuovo `type` non visto rende neutro invece di crash. |
| Drawer focused message resolution | `focusedMessageId > streamingId > findLastAssistant(messages)` | Click sul bubble di un messaggio vecchio focalizza il drawer su quel reasoning. |

## Architecture

### Backend (`server/`)

```
server/
  domain/
    reasoning/
      reasoning.types.ts                # NEW: ReasoningStep, ReasoningStepType
      reasoning.schema.ts               # NEW: zod schemas
      reasoning.tracer.ts               # NEW: ReasoningTracer class
      reasoning.tracer.test.ts          # NEW
    dispatch/
      dispatch.service.ts               # MODIFY: integra tracer + forward thinking
      dispatch.service.test.ts          # MODIFY
      providers/
        provider.types.ts               # MODIFY: ProviderChunk +'thinking' + done.usage; ProviderRequest +thinking?
        gemini.provider.ts              # MODIFY: thinkingConfig + part discrimination + usageMetadata
        gemini.provider.test.ts         # MODIFY
        fake.provider.ts                # MODIFY: thoughtChunks opt + done.usage
        fake.provider.test.ts           # MODIFY
    history/
      history.types.ts                  # MODIFY: Message.reasoningSteps?: ReasoningStep[]
      history.schema.ts                 # MODIFY: MessageSchema +reasoningSteps optional array
      history.schema.test.ts            # MODIFY
      history.store.test.ts             # MODIFY (1 test: append/read preserva reasoningSteps)
  routes/
    dispatch.routes.test.ts             # MODIFY (test thinking forwarding)
```

#### Types

```ts
// server/domain/reasoning/reasoning.types.ts
export type ReasoningStepType =
  | 'context_fetch'
  | 'mcp_query'       // reserved (slice 7)
  | 'dispatch'
  | 'thinking'
  | 'validation'
  | 'logic';          // reserved

export interface ReasoningStep {
  id: string;
  type: ReasoningStepType;
  title: string;
  content: string;
  tokens?: number;
  durationMs?: number;
  subAgent?: string;   // reserved (slice 6)
  timestamp: number;
  // confidence intentionally omitted; ConfidenceBar UI is ready for future
}
```

#### `ReasoningTracer`

```ts
// server/domain/reasoning/reasoning.tracer.ts
export interface TracerStepOpts<T> {
  type: ReasoningStepType;
  title: string;
  run: () => Promise<{ content: string; tokens?: number; result: T }>;
}

export class ReasoningTracer {
  private steps: ReasoningStep[] = [];

  constructor(private readonly sse: SseEmitter) {}

  /**
   * Run a timed step. Measures durationMs via performance.now(), emits the
   * resulting ReasoningStep via sse.event('reasoning_step', step), and stores
   * it internally. If `run()` rejects, the step is NOT emitted and the rejection
   * propagates to the caller (so the dispatcher can decide how to translate to error).
   */
  async step<T>(opts: TracerStepOpts<T>): Promise<T> {
    const t0 = performance.now();
    const { content, tokens, result } = await opts.run();
    const t1 = performance.now();
    const step: ReasoningStep = {
      id: randomUUID(),
      type: opts.type,
      title: opts.title,
      content,
      tokens,
      durationMs: Math.round(t1 - t0),
      timestamp: Date.now(),
    };
    this.steps.push(step);
    this.sse.event('reasoning_step', step);
    return result;
  }

  /**
   * Record an externally-tracked step (e.g. thinking text accumulated across
   * many provider chunks). Emits SSE + accumulates.
   */
  pushExternal(partial: Omit<ReasoningStep, 'id' | 'timestamp'>): void {
    const step: ReasoningStep = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...partial,
    };
    this.steps.push(step);
    this.sse.event('reasoning_step', step);
  }

  /** Returns the accumulated steps (idempotent, returns a shallow copy). */
  finalSteps(): ReasoningStep[] {
    return [...this.steps];
  }
}
```

**Sequential assumption**: the tracer is invoked sequentially (`await tracer.step(...)`). Concurrent calls would yield non-deterministic ordering. The dispatcher follows this assumption strictly.

#### Provider changes

```ts
// provider.types.ts
export interface ProviderRequest {
  systemInstruction: string;
  history: { role: 'user' | 'model'; text: string }[];
  userMessage: string;
  thinking?: boolean;          // NEW
}

export interface ProviderUsage {
  totalTokens?: number;
}

export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }                   // NEW
  | { type: 'done'; usage?: ProviderUsage };             // CHANGED (was: { type: 'done' })

export interface AIProvider {
  readonly model: string;
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
```

#### `GeminiProvider`

```ts
async *stream(req, signal) {
  const contents = [
    ...req.history.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user' as const, parts: [{ text: req.userMessage }] },
  ];

  const config: Record<string, unknown> = {
    systemInstruction: req.systemInstruction,
    abortSignal: signal,
  };
  if (req.thinking) {
    config.thinkingConfig = { thinkingBudget: -1, includeThoughts: true };
  }

  const stream = await this.ai.models.generateContentStream({
    model: this.model,
    contents,
    config,
  });

  let lastUsage: ProviderUsage | undefined;
  for await (const chunk of stream) {
    if (signal.aborted) return;

    // Capture usage from any chunk that exposes it (Gemini puts it on the last chunk).
    const um = (chunk as { usageMetadata?: { totalTokenCount?: number } }).usageMetadata;
    if (um?.totalTokenCount !== undefined) {
      lastUsage = { totalTokens: um.totalTokenCount };
    }

    // Iterate candidates[0].content.parts; distinguish `part.thought === true` (thoughts)
    // from regular text parts. Fallback: chunk.text for backward compatibility with
    // non-thinking models or older SDK responses.
    const parts = (chunk as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
    }).candidates?.[0]?.content?.parts;

    if (parts && parts.length > 0) {
      for (const part of parts) {
        const text = part.text;
        if (typeof text !== 'string' || text.length === 0) continue;
        if (part.thought === true) yield { type: 'thinking', text };
        else yield { type: 'text', text };
      }
    } else {
      // Fallback: SDK might still expose chunk.text on non-thinking responses
      const text = (chunk as { text?: string }).text;
      if (typeof text === 'string' && text.length > 0) {
        yield { type: 'text', text };
      }
    }
  }
  if (!signal.aborted) yield { type: 'done', usage: lastUsage };
}
```

#### `FakeProvider`

```ts
export interface FakeProviderOptions {
  chunks: string[];
  thoughtChunks?: string[];      // NEW
  chunkDelayMs?: number;
  model?: string;
  totalTokens?: number;          // NEW: for done.usage
}

// behavior:
async *stream(req, signal) {
  // thoughtChunks emitted FIRST and ONLY when req.thinking === true
  if (req.thinking && this.opts.thoughtChunks) {
    for (const t of this.opts.thoughtChunks) {
      if (signal.aborted) return;
      await sleep(this.opts.chunkDelayMs ?? 0, signal);
      if (signal.aborted) return;
      yield { type: 'thinking', text: t };
    }
  }
  // normal text chunks
  for (const text of this.opts.chunks) {
    if (signal.aborted) return;
    await sleep(this.opts.chunkDelayMs ?? 0, signal);
    if (signal.aborted) return;
    yield { type: 'text', text };
  }
  if (!signal.aborted) {
    yield {
      type: 'done',
      usage: this.opts.totalTokens !== undefined ? { totalTokens: this.opts.totalTokens } : undefined,
    };
  }
}
```

#### `dispatch.service.handle` pipeline

```ts
DispatchRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  thinking: z.boolean().optional(),     // NEW
});

async handle(rawBody, sse, signal) {
  const parsed = DispatchRequestSchema.safeParse(rawBody);
  if (!parsed.success) { sse.error('Invalid request body', false); return; }
  const { sessionId, message, thinking } = parsed.data;

  const prior = await historyStore.read(sessionId);
  if (prior === null) {
    sse.event('error', { message: 'Session not found', retryable: false });
    sse.end();
    return;
  }

  const tracer = new ReasoningTracer(sse);

  let context;
  try {
    context = await tracer.step({
      type: 'context_fetch',
      title: 'Read context',
      run: async () => {
        const ctx = await contextStore.read();
        return {
          content: `loaded systemInstruction (${ctx.systemInstruction.length} chars)`,
          result: ctx,
        };
      },
    });
  } catch {
    sse.event('error', { message: 'Context load failed', retryable: true });
    sse.end();
    return;
  }

  await historyStore.append(sessionId, {
    id: randomUUID(), role: 'user', text: message, timestamp: Date.now(),
  });

  let accumText = '';
  let accumThought = '';
  let dispatchUsage: ProviderUsage | undefined;
  const dispatchStart = performance.now();

  try {
    await tracer.step({
      type: 'dispatch',
      title: `Dispatch to ${provider.model}${thinking ? ' (thinking)' : ''}`,
      run: async () => {
        const it = provider.stream(
          {
            systemInstruction: context.systemInstruction,
            history: prior.map(m => ({ role: m.role, text: m.text })),
            userMessage: message,
            thinking,
          },
          signal,
        );
        for await (const chunk of it) {
          if (signal.aborted) break;
          if (chunk.type === 'text') {
            accumText += chunk.text;
            sse.event('text', { chunk: chunk.text });
          } else if (chunk.type === 'thinking') {
            accumThought += chunk.text;
            sse.event('thinking', { chunk: chunk.text });
          } else if (chunk.type === 'done') {
            dispatchUsage = chunk.usage;
            break;
          }
        }
        return {
          content: `${accumText.length} chars streamed${accumThought.length > 0 ? `, ${accumThought.length} chars thinking` : ''}`,
          tokens: dispatchUsage?.totalTokens,
          result: null,
        };
      },
    });
  } catch (e) {
    const { message: msg, retryable } = classifyError(e);
    sse.event('error', { message: msg, retryable });
    await historyStore.append(sessionId, {
      id: randomUUID(),
      role: 'model',
      text: accumText,
      timestamp: Date.now(),
      model: provider.model,
      error: msg,
      retryable,
      reasoningSteps: tracer.finalSteps(),
    });
    sse.end();
    return;
  }

  if (accumThought.length > 0) {
    tracer.pushExternal({
      type: 'thinking',
      title: 'Gemini thoughts',
      content: accumThought,
      durationMs: Math.round(performance.now() - dispatchStart),
      tokens: undefined,
    });
  }

  await tracer.step({
    type: 'validation',
    title: 'Validate response',
    run: async () => {
      const ok = accumText.length > 0;
      const tokens = dispatchUsage?.totalTokens;
      return {
        content: `response length ${accumText.length}${tokens !== undefined ? `, tokens ${tokens}` : ''}${ok ? '' : ' (empty)'}`,
        tokens,
        result: null,
      };
    },
  });

  const interrupted = signal.aborted;
  const reasoningSteps = tracer.finalSteps();

  await historyStore.append(sessionId, {
    id: randomUUID(),
    role: 'model',
    text: accumText,
    timestamp: Date.now(),
    model: provider.model,
    interrupted,
    reasoningSteps,
  });

  sse.event('done', { model: provider.model, interrupted, reasoningSteps });
  sse.end();
}
```

#### Message + schema changes

```ts
// server/domain/history/history.types.ts (additive)
export interface Message {
  // ... existing fields ...
  reasoningSteps?: ReasoningStep[];   // NEW
}

// history.schema.ts
export const MessageSchema = z.object({
  // ... existing ...
  reasoningSteps: z.array(ReasoningStepSchema).optional(),   // NEW
});
```

`ReasoningStepSchema` imported from `@/server/domain/reasoning/reasoning.schema`.

### Frontend (`src/`)

```
src/
  types/
    reasoning.types.ts                 # NEW: re-export
  stores/
    chat.store.ts                      # MODIFY: +currentReasoning live + reasoningSteps on Message
    chat.store.test.ts                 # MODIFY
    ui.store.ts                        # NEW
    ui.store.test.ts                   # NEW
  hooks/
    useStreamingDispatch.ts            # MODIFY
    useStreamingDispatch.test.ts       # MODIFY
  lib/api/
    dispatch.api.ts                    # MODIFY: body.thinking
    dispatch.api.test.ts               # MODIFY
  components/
    chat/
      MessageBubble.tsx                # MODIFY: thinking/steps badges
      MessageBubble.test.tsx           # MODIFY
      MessageInput.tsx                 # MODIFY: brain icon toggle
      MessageInput.test.tsx            # MODIFY
      ChatView.tsx                     # MODIFY (passes through; minor)
      ChatView.test.tsx                # MODIFY (1 new test)
    reasoning/
      ReasoningDrawer.tsx              # NEW
      ReasoningDrawer.test.tsx         # NEW
      ReasoningStepCard.tsx            # NEW
      ReasoningStepCard.test.tsx       # NEW
      LiveThinkingBlock.tsx            # NEW
      ConfidenceBar.tsx                # NEW (renders null when confidence undefined)
      ConfidenceBar.test.tsx           # NEW
      DispatchBranch.tsx               # NEW (reserved for slice 6)
      DispatchBranch.test.tsx          # NEW
  App.tsx                              # MODIFY: mount ReasoningDrawer
  App.test.tsx                         # MODIFY
```

#### `useChatStore` extensions

```ts
interface CurrentReasoning {
  thinkingText: string;
  steps: ReasoningStep[];
}

interface ChatState {
  // existing fields
  messages: Message[];
  streamingId: string | null;
  abortController: AbortController | null;
  hydrated: boolean;

  // NEW
  currentReasoning: CurrentReasoning;

  // existing actions
  hydrate, appendUser, startAssistant, appendChunk, failAssistant, setAbortController, abort, reset, _reset

  // NEW
  appendThinkingChunk: (text: string) => void;
  appendReasoningStep: (step: ReasoningStep) => void;

  // MODIFIED
  finishAssistant: (id, opts: {
    model?: string;
    interrupted?: boolean;
    reasoningSteps?: ReasoningStep[];
  }) => void;
}
```

Behavior:
- `startAssistant()` resets `currentReasoning = { thinkingText: '', steps: [] }`.
- `appendThinkingChunk(text)` → `currentReasoning.thinkingText += text`.
- `appendReasoningStep(step)` → push into `currentReasoning.steps`.
- `finishAssistant(id, {reasoningSteps})` attaches `reasoningSteps` to the message and resets `currentReasoning`.
- `failAssistant(id, error, retryable)` resets `currentReasoning` (the partial reasoning gathered so far is discarded from the live store; the server already persisted them in `Message.reasoningSteps` and will be available on reload).

#### `useUiStore` (new)

```ts
interface UiState {
  reasoningDrawerOpen: boolean;
  thinkingEnabled: boolean;        // persisted localStorage 'aether.thinkingEnabled'
  focusedMessageId: string | null;

  toggleReasoningDrawer: () => void;
  openReasoningDrawer: () => void;
  closeReasoningDrawer: () => void;
  setThinkingEnabled: (v: boolean) => void;
  setFocusedMessageId: (id: string | null) => void;
  _reset: () => void;
}
```

`thinkingEnabled` is read from localStorage on init (try/catch defensive). The drawer open state is NOT persisted (always closed on load to avoid invasive UX).

#### `useStreamingDispatch` changes

```ts
async send(text) {
  // ... existing trim/active checks ...
  const thinkingEnabled = useUiStore.getState().thinkingEnabled;
  // ... local auto-title (slice 2b) ...

  for await (const ev of createStreamingDispatch({ sessionId, message: trimmed, thinking: thinkingEnabled }, signal)) {
    if (ev.event === 'text') chatStore.appendChunk(id, ev.data.chunk);
    else if (ev.event === 'thinking') {
      chatStore.appendThinkingChunk(ev.data.chunk);
      // open drawer on first thinking chunk of THIS stream
      if (!firstThinkingSeen) {
        firstThinkingSeen = true;
        useUiStore.getState().openReasoningDrawer();
      }
    }
    else if (ev.event === 'reasoning_step') chatStore.appendReasoningStep(ev.data as ReasoningStep);
    else if (ev.event === 'done') {
      const d = ev.data as { model?: string; interrupted?: boolean; reasoningSteps?: ReasoningStep[] };
      chatStore.finishAssistant(id, {
        model: d.model,
        interrupted: !!d.interrupted,
        reasoningSteps: d.reasoningSteps,
      });
      return;
    }
    else if (ev.event === 'error') {
      const d = ev.data as { message: string; retryable: boolean };
      chatStore.failAssistant(id, d.message, !!d.retryable);
      return;
    }
  }
  // ... fallback finalize as before ...
}
```

#### `ReasoningDrawer`

```tsx
export function ReasoningDrawer() {
  const open = useUiStore((s) => s.reasoningDrawerOpen);
  const close = useUiStore((s) => s.closeReasoningDrawer);
  const focusedId = useUiStore((s) => s.focusedMessageId);
  const streamingId = useChatStore((s) => s.streamingId);
  const messages = useChatStore((s) => s.messages);
  const currentReasoning = useChatStore((s) => s.currentReasoning);

  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'model')?.id ?? null,
    [messages],
  );
  const activeId = focusedId ?? streamingId ?? lastAssistantId;
  const activeMessage = messages.find((m) => m.id === activeId);
  const isLive = streamingId !== null && activeId === streamingId;

  const steps = isLive ? currentReasoning.steps : (activeMessage?.reasoningSteps ?? []);
  const liveThinking = isLive ? currentReasoning.thinkingText : '';

  if (!open) return null;

  return (
    <aside
      role="complementary"
      aria-label="Reasoning"
      className="fixed right-0 top-0 bottom-0 z-40 w-96 bg-surface-2 border-l border-border-subtle flex flex-col"
    >
      <header className="p-3 border-b border-border-subtle flex items-center justify-between">
        <span className="mono-label">Reasoning</span>
        <button aria-label="Close reasoning drawer" onClick={close} className="text-zinc-500 hover:text-white">×</button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {liveThinking && <LiveThinkingBlock text={liveThinking} />}
        {steps.map((s) => <ReasoningStepCard key={s.id} step={s} />)}
        {steps.length === 0 && !liveThinking && (
          <p className="text-zinc-500 text-xs italic">Nessuno step</p>
        )}
      </div>
    </aside>
  );
}
```

#### `MessageBubble` changes

Append to the bubble (after text, before error/interrupted footers):

```tsx
{(isThinkingNow || hasReasoningSteps) && (
  <button
    type="button"
    onClick={() => {
      useUiStore.getState().setFocusedMessageId(id);
      useUiStore.getState().openReasoningDrawer();
    }}
    className="mt-2 text-[10px] text-zinc-500 hover:text-accent flex items-center gap-1"
    aria-label="Show reasoning"
  >
    {isThinkingNow ? '💭 thinking…' : `🧠 ${message.reasoningSteps!.length} steps`}
  </button>
)}
```

Where:
- `isThinkingNow = useChatStore((s) => s.streamingId === id && s.currentReasoning.thinkingText.length > 0)`
- `hasReasoningSteps = (message.reasoningSteps?.length ?? 0) > 0`

#### `MessageInput` brain toggle

A small button next to Send (`<Brain/>` icon from lucide-react if available, else custom SVG). `aria-pressed` reflects `useUiStore.thinkingEnabled`. Click toggles. Visual: filled accent when on, outline when off. Tooltip: "Thinking mode (slower, shows reasoning)".

### Data model (key shapes)

```ts
// On disk (data/sessions.json) — Message gets optional reasoningSteps
{
  "<uuid>": {
    "title": "...",
    "createdAt": 1779...,
    "messages": [
      { "id":..., "role":"user", "text":"...", "timestamp":... },
      {
        "id":..., "role":"model", "text":"...", "timestamp":...,
        "model":"gemini-2.5-flash", "interrupted":false,
        "reasoningSteps": [
          { "id":..., "type":"context_fetch", "title":"Read context", "content":"...", "durationMs":4, "timestamp":... },
          { "id":..., "type":"dispatch", "title":"Dispatch to gemini-2.5-flash (thinking)", "content":"... chars streamed, ... chars thinking", "tokens":1234, "durationMs":820, "timestamp":... },
          { "id":..., "type":"thinking", "title":"Gemini thoughts", "content":"...", "durationMs":820, "timestamp":... },
          { "id":..., "type":"validation", "title":"Validate response", "content":"response length ..., tokens 1234", "tokens":1234, "durationMs":1, "timestamp":... }
        ]
      }
    ]
  }
}

// Wire (SSE events)
event: text             data: { chunk: string }
event: thinking         data: { chunk: string }
event: reasoning_step   data: ReasoningStep
event: done             data: { model: string, interrupted: boolean, reasoningSteps: ReasoningStep[] }
event: error            data: { message: string, retryable: boolean }

// Body
POST /api/ai/dispatch   { sessionId: string, message: string, thinking?: boolean }
```

## Data flow

(See brainstorming Sezione 3 for complete tracing. Summary:)

- **Happy path with thinking=true**: send → tracer.step(context_fetch) → user append → tracer.step(dispatch) yields text/thinking chunks via SSE → tracer.pushExternal(thinking) if thoughts accumulated → tracer.step(validation) → final append + done(reasoningSteps).
- **Happy path with thinking=false**: identical but no thinking chunks; 3 final steps instead of 4.
- **Abort mid-stream**: dispatch step content reflects partial state; thinking step pushed if any accumulated; validation step records aborted state; final message saved with `interrupted: true` and `reasoningSteps[]`.
- **Provider error**: classifyError → `sse.event('error', {message, retryable})`; final message saved with partial `reasoningSteps[]` (those emitted before the throw); client `failAssistant` resets `currentReasoning`.
- **Reload**: `Message.reasoningSteps?` persisted; hydrated messages keep their reasoning; click on old bubble badges opens drawer focused on that message.

## Error handling & edge cases

(See brainstorming Sezione 4 for full table. Key invariants:)

1. **Tracer `step()` propagation**: if `run()` throws, the step is NOT emitted (caller decides translation to `sse.error`).
2. **Sequential tracer usage**: `await tracer.step(...)` always. Concurrent calls would produce non-deterministic ordering — guarded by code review and integration tests.
3. **`pushExternal` for thinking step**: chiamato dopo che il dispatch step è completato. Se il provider throws PRIMA che `accumThought.length > 0` venga raggiunto, thoughts parziali NON entrano nel reasoningSteps (sono persi a livello server; il client ha già visto i chunk via `event:thinking` ma li resetta in `failAssistant`).
4. **`thinking:true` su modello non-thinking**: API Gemini ignora silenziosamente `thinkingConfig`. Niente thoughts emessi → niente `thinking` step pushExternal → drawer mostra 3 step invece di 4. UX degradata, non rotta.
5. **`Message.reasoningSteps` undefined per messaggi 2a/2b legacy**: badge `🧠 N steps` non appare; click sul bubble (se mai cliccato) → drawer vuoto. Backward-compat trasparente.
6. **`focusedMessageId` cleanup**: il `useStreamingDispatch.send()` chiama `useUiStore.setFocusedMessageId(null)` al primo step (dopo il guard su `trimmed`), così che la drawer durante il nuovo stream punti naturalmente allo `streamingId` corrente invece che a un messaggio vecchio focalizzato in precedenza. Il close button del drawer chiama lo stesso reset.
7. **`performance.now()` server-side**: monotonico, immune a system clock changes. `timestamp` resta `Date.now()` per ordinamento globale e display.
8. **Resilient client parsing**: useStreamingDispatch NON valida via zod gli eventi. Step con `type` sconosciuto → `ReasoningStepCard` rende fallback neutro invece di crashare.
9. **Drawer focus resolution**: `focusedMessageId ?? streamingId ?? findLastAssistant(messages)`. Predicibile e deterministica.
10. **`reasoningSteps` molto grosso**: best-effort, non ottimizziamo `sessions.json` size in 3. Future slice può separare in file dedicato.

## Testing strategy

(See brainstorming Sezione 5 for the full matrix.)

### Backend

- `reasoning.schema.test.ts` — parse required + optional fields, reject unknown type via zod enum
- `reasoning.tracer.test.ts` — timing, SSE emit, accumulate, run() rejection propagation, idempotent finalSteps()
- `fake.provider.test.ts` — thoughtChunks emesso solo con req.thinking=true; done.usage popolato se totalTokens fornito
- `gemini.provider.test.ts` — config.thinkingConfig presente con thinking=true, assente con false; part.thought=true → `thinking` chunk; usageMetadata estratto in done
- `dispatch.service.test.ts` — emette i 4 step in ordine con thinking=true; 3 con thinking=false; provider error preserva partial steps in append; abort preserva steps
- `dispatch.routes.test.ts` — body.thinking forwarded, non-boolean → 'Invalid request body'
- `history.schema.test.ts` — Message accetta reasoningSteps opzionale
- `history.store.test.ts` — append/read preserva reasoningSteps

### Frontend

- `chat.store.test.ts` — appendThinkingChunk + appendReasoningStep + finishAssistant{reasoningSteps} + currentReasoning lifecycle
- `ui.store.test.ts` — toggle/open/close drawer; setThinkingEnabled persiste; setFocusedMessageId; init legge localStorage
- `dispatch.api.test.ts` — body include thinking quando passato
- `useStreamingDispatch.test.ts` — legge thinking da ui.store; thinking event apre drawer (solo prima volta); reasoning_step accumula
- `MessageBubble.test.tsx` — `💭 thinking…` solo se streamingId match + currentReasoning.thinkingText > 0; `🧠 N steps` se reasoningSteps.length > 0; click apre drawer + setFocusedMessageId
- `MessageInput.test.tsx` — brain toggle aria-pressed reflette thinkingEnabled; click toggla
- `ReasoningDrawer.test.tsx` — closed → null; live mode → LiveThinkingBlock + currentReasoning.steps; static mode → activeMessage.reasoningSteps; focus resolution priority
- `ReasoningStepCard.test.tsx` — render per type; durationMs format; tokens placeholder se undefined; unknown type → neutral
- `ConfidenceBar.test.tsx` — undefined → null; numero → bar
- `DispatchBranch.test.tsx` — undefined → null; string → pill
- `ChatView.test.tsx` — 1 test: streaming con thinking apre drawer + LiveThinkingBlock visibile
- `App.test.tsx` — drawer mounted (anche se chiuso non rendered)

### E2E (Playwright)

`e2e/smoke.spec.ts` aggiunge:
```ts
test('reasoning: thinking on emits steps + opens drawer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /thinking/i }).click();   // enable
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('think');
  await input.press('Enter');
  await expect(page.getByRole('complementary', { name: /reasoning/i })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/Dispatch to|Validate response/)).toBeVisible({ timeout: 5000 });
});
```

`server/index.ts` configura il `FakeProvider` (env `AETHER_FAKE_PROVIDER=1`) con `thoughtChunks: ['thinking about it…']` così il path thinking è deterministico in E2E.

### Coverage thresholds

Invariate (80% per folder). Tutti i nuovi file ricadono in folder già gated:
- `server/domain/reasoning/**` → coperto da `server/domain/**`
- `src/stores/ui.store.ts` → coperto da `src/stores/**`
- `src/components/reasoning/**` → componenti non in gate
- `src/hooks/useStreamingDispatch.ts` → coperto da `src/hooks/**`

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Gemini SDK API per `thinkingConfig` cambia | Provider wrappa solo gli accessi sicuri (chunk.candidates[0].content.parts), pin con SDK mock tests. Fallback su chunk.text se la struttura nuova è inattesa. |
| `tracer.pushExternal` race con `step()` concorrente | Documentato come sequenziale; integration test forza sequenzialità. |
| `reasoningSteps` molto grosso esplode `sessions.json` | Best-effort accettato. Future slice considera storage separato. |
| Drawer reflow durante thoughts molto rapidi | Stesso pattern di `appendChunk` (accettato in 2a). |
| `event: reasoning_step` payload non zod-validato sul client | Decisione cosciente per resilienza a backend evolution. `ReasoningStepCard` ha fallback per type sconosciuto. |
| User abilita thinking ma usa modello non-thinking | UX degradata (no thoughts, 3 step invece di 4) ma non rotta. Future slice può aggiungere detection. |

## Open items

- **Tooltip a11y per i bubble badges**: lasciamo solo `aria-label`. `<Tooltip>` (slice 0) opzionale se serve.
- **Brain icon scelta**: `Brain` da lucide-react se disponibile in versione installata, altrimenti SVG custom.

## Approval

Spec approvata in brainstorming session 2026-05-18. Tutte le 5 sezioni (backend, frontend, data flow, error handling, testing) confermate.

**Next:** invocare `superpowers:writing-plans` per generare il piano implementativo TDD.
