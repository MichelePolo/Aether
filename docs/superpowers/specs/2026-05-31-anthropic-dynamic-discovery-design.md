# Anthropic Dynamic Model Discovery — Design

## Problem
The Anthropic model list is hardcoded in `anthropicHardcodedModels()`
(`server/domain/providers/discovery.ts`). When Anthropic ships a new model
(e.g. `claude-opus-4-8`), the Aether picker keeps showing stale models until the
list is edited by hand in several places. We want the picker to reflect the
models the account can actually use, fetched live from the official endpoint.

## Goals
- Fetch the Anthropic model list at registry `refresh()` time from
  `GET /v1/models`, ordered newest-first.
- Make a failed discovery **visible in the UI** (the user's explicit ask),
  rather than letting Anthropic silently vanish from the picker.
- Keep the Settings → Provider Auth status coherent with discovery health.

## Decisions (from brainstorming)
- **apikey** → dynamic discovery via `/v1/models`. On any failure
  (network / timeout / non-2xx) → **no models**, but surface the failure.
- **oauth** → the OAuth token is internal to the Claude CLI and not accessible
  to Aether, so there is no key to call `/v1/models`. Use
  `anthropicHardcodedModels()` (targeted exception — the "no hardcoded fallback"
  rule applies only to the apikey case).
- **none** → Anthropic skipped (unchanged).
- **Display** → show all returned models, sorted by `created_at` descending.
- **Perception** → when apikey discovery fails, the `ComposerModelPill` shows a
  greyed, non-selectable Anthropic row with a yellow warning icon and the
  technical reason in parentheses (e.g. `(401)`, `(timeout)`). The Settings
  Provider Auth row also reflects the error (`probeAnthropic` aligned).

## Architecture

### Source of truth for the model list: the registry
`registry.list()` keeps returning only usable entries (dispatch and selection
are unaffected). Discovery outcome is exposed separately as **issues**.

**`discoverAnthropic(apiKey, signal?)`** in `discovery.ts` returns
`{ models: string[]; error: string | null }`:
- `GET ${ANTHROPIC_MODELS_URL}?limit=1000` with headers
  `x-api-key: <key>`, `anthropic-version: ${ANTHROPIC_VERSION}`; 5s timeout via
  `AbortSignal.timeout(5000)`.
- Zod-parse `{ data: [{ id: string, created_at: string }] }`, sort by
  `created_at` desc, return `{ models: ids, error: null }`.
- On non-2xx → `{ models: [], error: String(status) }`; on parse failure →
  `{ models: [], error: 'parse' }`; on throw/timeout → `{ models: [], error:
  '<network code>' | 'timeout' }` (same reason mapping style as auth-status'
  `shortReason`).
- Export `ANTHROPIC_MODELS_URL` (`https://api.anthropic.com/v1/models`) and
  `ANTHROPIC_VERSION` (`2023-06-01`) so `auth-status` reuses the same constants
  (no drift).
- `anthropicHardcodedModels()` stays — it is the source for the oauth branch.

**`ProviderRegistry`** (`registry.ts`):
- New private `issues: RegistryIssue[]`, cleared at the start of each
  `refresh()`; public getter `issues()`.
- `RegistryIssue = { transport: ProviderTransport; reason: string }`.
- Anthropic block:
  - `apikey`: `const { models, error } = await discoverAnthropic(resolveKey('anthropic')!)`.
    If `models.length` → register one entry per model. Else →
    `issues.push({ transport: 'anthropic', reason: error ?? 'no models' })`
    (no entries).
  - `oauth`: register entries from `anthropicHardcodedModels()`.
  - `none`: nothing.

### Types
- `AnthropicProviderOpts.model`: literal union → `string` (dynamic IDs are
  arbitrary). Drop the `as '...'` cast in `index.ts`.

### Routes
- `GET /providers` and `POST /providers/refresh` return
  `{ providers: registry.list(), issues: registry.issues() }`.

### Settings coherence: align `probeAnthropic`
`AuthStatusService.probeAnthropic` currently does no network call for apikey.
Change it so the apikey branch actually validates against `/v1/models` (matching
`probeOpenAI`/`probeGemini`, which each do their own `fetchWithTimeout`):
- Add dep `getAnthropicKey: () => string | undefined`, wired in `index.ts` with
  `() => resolver.get('anthropic')`.
- `detect === 'apikey'`: `fetchWithTimeout(ANTHROPIC_MODELS_URL, { headers:
  { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION } })`. `res.ok` →
  `{ state: 'ok', reason: 'api key set' }`; else → `{ state: 'error', reason:
  String(res.status), detail: res.statusText }`. Thrown errors are mapped to
  `state: 'error'` by the existing `probeOne` try/catch.
- `detect === 'oauth'` → `{ state: 'ok', reason: 'oauth' }` (unchanged).
- `detect === 'none'` → `{ state: 'unconfigured', reason: 'no api key' }`.

This is an independent second call to `/v1/models` (status probe vs. model
discovery), consistent with how OpenAI/Gemini are already handled.

### Frontend
- `providers.api.ts`: `list()` and `refresh()` also read `issues` from the
  response.
- `providers.store.ts`: new state `issues: RegistryIssue[]`, populated in
  `init`/`refresh`.
- `ComposerModelPill.tsx`: after `list.map(...)`, for each issue whose transport
  has no entry in `list`, render a disabled `<div>` (not a `<button>`): grey
  text `Anthropic — impossibile recuperare i modelli ({reason})` with a yellow
  `AlertTriangle` (lucide) icon. Not selectable, no `role="menuitemradio"`.

## Testing
- `discoverAnthropic`: happy path (sorted newest-first), non-2xx → error,
  malformed body → error, timeout/throw → error.
- `registry.refresh`: apikey + success → entries, `issues()` empty; apikey +
  failure → no entries, `issues()` = `[{ transport: 'anthropic', reason }]`;
  oauth → hardcoded entries, no issue; none → nothing.
- `auth-status`: apikey + 200 → ok; apikey + 401 → error with reason `401`;
  apikey + thrown → error; oauth → ok; none → unconfigured.
- `providers.routes`: `/` and `/refresh` include `issues`.
- `providers.store`: stores `issues` from init/refresh.
- `ComposerModelPill`: with an issue and no entries → disabled row with warning
  icon and reason text, not clickable.
- Coverage thresholds (80%) on `server/domain/**`, `server/lib/**`,
  `src/stores/**`, `src/lib/**`.

## Open Questions / Notes
- **Alias vs. snapshot IDs.** `/v1/models` may return dated IDs
  (`claude-opus-4-...`) rather than short aliases. The configured default
  `anthropic:claude-opus-4-8` then won't match a registry entry and
  `defaultName()` falls back to its priority order. Acceptable for now; revisit
  if it confuses default selection.
- The pill text is a literal string (matching the component's existing
  literals like "No models available"); not routed through `src/i18n/` to keep
  scope tight. Flag if i18n is desired.
