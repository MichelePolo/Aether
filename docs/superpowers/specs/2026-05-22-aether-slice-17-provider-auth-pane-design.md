# Aether Slice 17 — Provider auth status pane (design spec)

**Date:** 2026-05-22
**Branch:** `feat/slice-17-provider-auth-pane`
**Roadmap entry:** docs/superpowers/roadmap.md → "Slice 17 — Provider auth status pane"

## Goal

Surface the live auth status of all configured providers (Anthropic, OpenAI, Gemini, Ollama) in the sidebar so the user knows at a glance which providers are reachable, which are unconfigured, and which are failing — without having to read the server log.

## Scope decisions

| Decision | Choice |
|---|---|
| Probe depth | Config check + cheap network probe per transport. |
| UI placement | Sidebar section at the bottom (below MCP Servers). |
| Refresh policy | On app load + on any dispatch error + manual ↻ button. |
| Row detail | Status dot + label + short reason; full message in `title=` tooltip. |
| Re-probe scope on dispatch error | Only the failing transport (not all four). |
| Timeout per probe | 5s (matches existing `SDK_PROBE_TIMEOUT_MS` for Anthropic). |
| Run order | All 4 probes in parallel via `Promise.all`. |

## Data shapes

```ts
// server/domain/providers/auth-status.types.ts
export type ProviderTransport = 'anthropic' | 'openai' | 'gemini' | 'ollama';
export type AuthState = 'ok' | 'unconfigured' | 'error';

export interface TransportStatus {
  transport: ProviderTransport;
  state: AuthState;
  reason: string;       // one short phrase
  detail?: string;      // longer text shown in tooltip on error
}

export interface AuthStatusReport {
  statuses: TransportStatus[];   // always 4 entries in fixed order
  checkedAt: number;
}
```

## Probe semantics (per transport)

| Transport | `ok` | `unconfigured` | `error` |
|---|---|---|---|
| Anthropic | `detectAnthropicAuth()` returns `'oauth'` or `'apikey'` | `'none'` and `claude` CLI absent | `'none'` with CLI present (SDK probe failed) |
| OpenAI | `OPENAI_API_KEY` set + `GET /v1/models` returns 200 | no env var | 401/403/network/timeout |
| Gemini | `GEMINI_API_KEY` set + `GET /v1beta/models?key=…` returns 200 | no env var | 401/403/network/timeout |
| Ollama | `GET ${OLLAMA_HOST}/api/tags` returns 200 | (n/a — local-only) | network/timeout |

**`reason` short phrases (deterministic strings):**

- `ok` Anthropic: `'oauth'` or `'api key set'` (from existing detector).
- `ok` OpenAI / Gemini: `'api key set'`.
- `ok` Ollama: `'<n> models'` (e.g. `'12 models'`).
- `unconfigured`: `'no api key'`.
- `error`: HTTP status code (`'401'`, `'403'`, `'500'`) or short network code (`'ECONNREFUSED'`, `'timeout'`).

`detail` is populated only on `error` — full message, status text, or `err.message`.

A probe that times out or throws returns a `TransportStatus { state: 'error', reason: <short>, detail: <full> }`. **The probe never throws upward.** The service always returns a full 4-entry report.

## Architecture

### Server

- **`server/domain/providers/auth-status.types.ts`** (new) — the type aliases above.
- **`server/domain/providers/auth-status.ts`** (new) — `class AuthStatusService`:
  ```ts
  constructor(deps: {
    detectAnthropicAuth: () => Promise<'oauth' | 'apikey' | 'none'>;
    openAIApiKey: string | undefined;
    geminiApiKey: string | undefined;
    ollamaHost: string;
    claudeCliPresent?: () => Promise<boolean>;   // optional helper for 'unconfigured' vs 'error' distinction on anthropic
  });
  probe(transports?: ProviderTransport[]): Promise<AuthStatusReport>;
  ```
  Internally calls four private probe functions in parallel. Each takes only the deps it needs and returns a `TransportStatus`. Timeouts implemented per-probe with `AbortController` (5s default).
- **`server/routes/providers.routes.ts`** — extend the existing router with:
  - `GET /auth-status` → `200 { statuses, checkedAt }`.
  - `POST /auth-status/refresh?transport=<one>` → re-probes one transport, merges with previous statuses for the other 3; without the query param, re-probes all 4.
  - Returns `503` when `authStatusService` dep is absent (mirrors the existing dispatcher pattern).
- **`server/app.ts`** — add `authStatusService?: AuthStatusService` to `AppDeps`; pass through to the providers routes factory.
- **`server/index.ts`** — bootstrap: construct `new AuthStatusService({ detectAnthropicAuth, openAIApiKey, geminiApiKey, ollamaHost })`, wire into `createApp`.

### Frontend

- **`src/types/provider-auth.types.ts`** (new) — mirror of server types.
- **`src/lib/api/providers.api.ts`** — extend with:
  ```ts
  fetchAuthStatus(): Promise<AuthStatusReport>;
  refreshAuthStatus(transport?: ProviderTransport): Promise<AuthStatusReport>;
  ```
- **`src/stores/providerAuth.store.ts`** (new) — Zustand:
  - State: `statuses: TransportStatus[]`, `checkedAt: number | null`, `loading: boolean`, `error: string | null`.
  - Actions: `init()`, `refresh(transport?)`.
  - **Dedupe:** in-flight refreshes are tracked by transport key (`'all' | 'anthropic' | …`). A second call for the same key while one is in flight is silently dropped.
- **`src/components/sidebar/ProviderAuthSection.tsx`** (new):
  - Header row: section title `Providers` + tiny `↻` button (`aria-label="Refresh provider auth"`).
  - Body: 4 rows in fixed order (anthropic, openai, gemini, ollama). Each row: status dot (●/○ with color class), transport name, ` / `, reason. `title=detail` on the row when `detail` is set.
- **`src/App.tsx`** — call `useProviderAuthStore.getState().init()` once at mount alongside the other init calls.
- **`src/components/layout/SidebarPanel.tsx`** (or wherever `McpServersSection` is mounted) — append `<ProviderAuthSection />` below MCP.
- **`src/hooks/useStreamingDispatch.ts`** — in the existing dispatch-error path:
  ```ts
  const transport = providerName.split(':')[0];
  if (['anthropic','openai','gemini','ollama'].includes(transport)) {
    useProviderAuthStore.getState().refresh(transport as ProviderTransport);
  }
  ```
  Fire-and-forget. `'fake'` transports skip.

### MSW

- **`src/test/msw-handlers.ts`** — defaults:
  - `GET /api/providers/auth-status` → 4 `unconfigured` rows.
  - `POST /api/providers/auth-status/refresh` → echoes the same 4 rows.

## Data flow

### Initial load
1. App mounts → `useProviderAuthStore.init()` fires.
2. Store sets `loading: true`, GETs `/api/providers/auth-status`.
3. Server calls `authStatusService.probe()` (no filter → all 4).
4. `probe()` runs the 4 probe functions in parallel; each wrapped in try/timeout. Returns `AuthStatusReport`.
5. Store stores `statuses` and `checkedAt`, clears `loading`.

### Manual refresh
1. ↻ click → `useProviderAuthStore.refresh()` (no arg).
2. Store sets `loading: true`, POSTs `/api/providers/auth-status/refresh`.
3. Server re-probes all 4; store replaces.

### Targeted refresh from dispatch error
1. `useStreamingDispatch` receives an SSE `error` event.
2. Hook derives `transport = providerName.split(':')[0]`. For `fake` it returns and does nothing.
3. `useProviderAuthStore.getState().refresh(transport)` (fire-and-forget).
4. Store dedupes; POSTs `/api/providers/auth-status/refresh?transport=<transport>`.
5. Server re-probes only that transport; response merges with prior statuses for the other 3.
6. Store merges in the updated row, leaves others untouched.

## Error handling

| Error | Where | Surface |
|---|---|---|
| Provider probe timeout | Server, per probe | `state: 'error'`, `reason: 'timeout'`, `detail: <message>` |
| Provider probe network failure | Server, per probe | `state: 'error'`, `reason: <code>`, `detail: <err.message>` |
| Pane's own fetch fails | FE | `useProviderAuthStore.error = <message>`; pane renders error banner; ↻ still available |
| `authStatusService` not configured server-side | Server | `503` (mirrors existing dispatcher pattern); FE surfaces via banner |

A probe never throws upward. The service always returns a full 4-entry report (even if all 4 errored).

## Testing strategy

### Server (vitest)
- **`auth-status.test.ts`** (new):
  - All-OK: stub all four probes; assert 4 statuses with `state: 'ok'`.
  - Mixed: anthropic `ok`, openai `unconfigured`, gemini `error('401')`, ollama `error('ECONNREFUSED')`.
  - Single-transport: `probe(['anthropic'])` returns only anthropic.
  - Timeout: a probe that hangs returns `state: 'error', reason: 'timeout'` within ~5s.
  - Each probe individually catches errors and never throws.
- **`providers.routes.test.ts`** — extend:
  - `GET /auth-status` returns 200 + report with 4 entries.
  - `POST /auth-status/refresh` (no body) returns updated 4-entry report.
  - `POST /auth-status/refresh?transport=anthropic` re-probes only anthropic; merges with prior statuses for the other 3.
  - Both routes return 503 when `authStatusService` dep is absent.

### Frontend (vitest + RTL + MSW)
- **`providers.api.test.ts`** — extend: `fetchAuthStatus()` GETs and parses; `refreshAuthStatus(transport?)` POSTs with the right URL (no query when omitted, query when present).
- **`providerAuth.store.test.ts`** (new):
  - `init()` populates `statuses`, sets `checkedAt`, clears `loading`.
  - `refresh()` re-fetches; `loading` toggles correctly.
  - `refresh('anthropic')` merges the new row, leaves the other three unchanged.
  - Dedupe: two simultaneous `refresh('anthropic')` only fire one POST.
  - Network failure → `error` populated, `loading` false.
- **`ProviderAuthSection.test.tsx`** (new):
  - Renders 4 rows in fixed order.
  - Dot color reflects state.
  - ↻ button calls `refresh()`; rows update.
  - `title=` attribute equals `detail` when present.
- **`useStreamingDispatch.test.tsx`** — extend: dispatch-error path calls `useProviderAuthStore.refresh('<transport>')` for non-fake transports; skips for `fake`.

### Integration (vitest + RTL + MSW)
- **`src/integration/provider-auth.integration.test.tsx`**:
  - App mounts → MSW returns 4-entry report → all 4 rows rendered in the sidebar.
  - Force a dispatch failure → assert the relevant transport row was re-fetched (MSW captures the URL with the `transport` query param).

### Playwright (e2e/smoke.spec.ts)
- One smoke: open the app → assert the Providers section is visible with 4 rows → click ↻ → rows still present.

## Out of scope

- Editing API keys from the UI (still env-var only).
- Per-model status (this is per-transport).
- Probe history / charting / metrics.
- Notifications or toasts on status change.
- Background polling beyond the load + manual + dispatch-error triggers.

## Acceptance criteria

1. The sidebar shows a `Providers` section with exactly 4 rows in fixed order: Anthropic, OpenAI, Gemini, Ollama.
2. Each row visibly conveys: a colored dot (state), the transport label, ` / `, and a one-phrase reason.
3. Hovering an `error` row surfaces the full detail via a native tooltip.
4. The ↻ button re-runs all 4 probes; rows update without a page reload.
5. After a failed chat dispatch, the failing transport's row re-probes automatically; other rows stay as-is.
6. `Cmd+K`–opened palette is unaffected (no new commands required for this slice).
7. Probes have a 5s timeout; a hanging provider does not block the others.
8. The service always returns a 4-entry report — even when all 4 probes error.
