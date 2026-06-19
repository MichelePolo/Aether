# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Aether Core — a local-first, multi-provider agentic LLM dev studio. A React 19 SPA and an Express + SQLite backend run from a **single Node process**: in dev, Express serves the API and mounts the Vite dev server as middleware (there is no separate frontend server); in production it serves the prebuilt SPA from `dist/`.

## Commands

```bash
npm run dev                      # Start everything (Express + Vite middleware) on http://localhost:3000
AETHER_FAKE_PROVIDER=1 npm run dev   # Run with the deterministic Fake provider — no API keys needed
npm run lint                     # Type-check (tsc --noEmit) — this IS the lint step; there is no ESLint
npm run build                    # vite build + esbuild bundle the server to dist/server.cjs
npm start                        # Run the production bundle (expects NODE_ENV=production)

npm test                         # Vitest watch mode
npm run test:run                 # Vitest once
npm run test:coverage            # Vitest with v8 coverage (thresholds enforced — see below)
npm run test:e2e                 # Playwright e2e (e2e/, auto-starts the dev server)
```

Running a focused test (Vitest):
```bash
npx vitest run server/domain/dispatch/dispatch.service.test.ts   # one file
npx vitest run -t "rejects unsupported MIME"                     # by test name
npx vitest run --project backend                                 # only the backend project (see below)
npx vitest run --project frontend                                # only the frontend project
```

## Test layout (non-obvious)

Vitest runs **two projects** (`vitest.config.ts`): `frontend` (jsdom, matches `src/**/*.{test,spec}.{ts,tsx}`) and `backend` (node, matches `server/**/*.{test,spec}.ts`). Tests are colocated next to source as `*.test.ts(x)`. Vitest `globals` are on, so `describe/it/expect` need no import. Coverage thresholds of **80%** are enforced on `server/domain/**`, `server/lib/**`, `src/hooks/**`, `src/stores/**`, `src/lib/**`. E2e tests live in `e2e/` and use Playwright (separate from Vitest).

## Import paths

`@/*` aliases the repo root in `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts`. Imports are written from the root, e.g. `@/server/domain/...` and `@/src/stores/...`. TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`; `noEmit` is set because the bundlers (Vite/esbuild) produce the output.

## Backend architecture

**Composition root.** `server/index.ts` `bootstrap()` opens the DB, applies migrations, constructs every store/service/provider, then hands them to `createApp(deps)` in `server/app.ts`. `createApp` mounts each route group **only if its dependency is present** (`AppDeps` fields are all optional). This is why unit tests can build a minimal app wired with just the one or two deps they exercise. The Express error middleware is registered **last**; `AppError`/`ValidationError` (`server/lib/errors.ts`) serialize to `{ error: { code, message } }` with the right status.

**Domain layer.** `server/domain/<feature>/` for: `context`, `dispatch`, `history`, `mcp`, `profiles`, `providers`, `reasoning`, `search`, `subagents`, `workspaces`. Each feature typically pairs a SQLite-backed `*.store.ts`, a `*.service.ts`, `*.types.ts`, and a `createXxxRoutes()` factory under `server/routes/*.routes.ts`.

**Persistence.** `better-sqlite3` (synchronous), single file at `${AETHER_DATA_DIR}/aether.sqlite`. Schema evolves via **append-only** numbered migrations in `server/db/migrations/NNN_name.sql`, applied in numeric order on boot, each inside a transaction, tracked in the `_migrations` table (`server/db/migrate.ts`). **Add a new migration file to change schema; never edit an existing one** (it won't re-run). Foreign keys are ON with `ON DELETE CASCADE`/`SET NULL` for cascade behavior.

**Providers.** The `AIProvider` interface (`server/domain/dispatch/providers/provider.types.ts`) is implemented by `fake`, `gemini`, `ollama`, `anthropic`, `openai`. `ProviderRegistry` (`server/domain/providers/registry.ts`) builds a map keyed `transport:model` (e.g. `gemini:gemini-1.5-pro`, `anthropic:claude-opus-4-7`) on `refresh()`, including a provider **only when its credential is resolvable** (Ollama models via live discovery of `/api/tags`). `KeyResolver` resolves keys **env-first, then the in-app KeyVault** (`key-vault.ts`, AES-256-GCM in SQLite). Provider selection is "sticky": a session stores its own `providerName`; the TopBar selector updates the active session and sets the localStorage default for new sessions.

**Dispatch — the core agentic loop.** `DispatchService.handle()` (`server/domain/dispatch/dispatch.service.ts`) is the heart of the app:
1. Resolve provider: request body `providerName` → session's `providerName` → registry default.
2. Read context, resolve a leading `@subagent` mention, preprocess attachments (text files inlined as fenced code blocks; images passed only to vision-capable providers; 10 MB total cap).
3. `assemble()` builds the system instruction + tool declarations from context + subagent + live MCP tools.
4. `runDispatchLoop()` streams provider chunks (`text` / `thinking` / `function_call` / `done`) out as **SSE events**, executes MCP tool calls (capped per dispatch — default 25, override via `AETHER_MAX_TOOL_CALLS`). Each tool call is gated by `BreakpointService` → `auto` (run) or `gate` (await a user approve/reject decision, 24h timeout).
5. `ReasoningTracer` records steps; user and model messages (with usage tokens, reasoning steps, interrupted flag) are persisted to `HistoryStore`.

`resume()` continues an interrupted model message. SSE is produced via `server/lib/sse.ts` (`SseEmitter`).

## Frontend architecture

React 19 + Zustand, one store per domain in `src/stores/*.store.ts`. **Stores never `fetch` inline** — they call thin API clients in `src/lib/api/*.api.ts`. `App.tsx` calls each store's `init()` once on mount. The common store pattern is **optimistic update then API call, rollback to the previous value on error** (see `src/stores/context.store.ts`). Streaming dispatch goes through `src/hooks/useStreamingDispatch.ts` + the SSE parser in `src/lib/sse-parser.ts`. Tailwind CSS v4, lucide icons, `cmdk` command palette, i18n strings in `src/i18n/`.

## Working conventions

- Work is organized as numbered **slices** on `feat/slice-N-*` branches (see `docs/superpowers/roadmap.md`); migration comments and tests reference slice numbers. New features are designed via the superpowers brainstorming → writing-plans → subagent-driven-development flow.
- `DISABLE_HMR=true` disables Vite HMR **and** file watching (used so agent edits don't trigger reload flicker). The conditional in `vite.config.ts` is intentional — don't "fix" it.
- Some code comments and the `docs/` audits are written in Italian; this is expected and not a signal to translate.

## Configuration

All env vars are optional (see `.env.example` and the README table). Key ones: `PORT` (3000), `AETHER_DATA_DIR` (`./data`), `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OLLAMA_HOST` to enable providers, `AETHER_DEFAULT_PROVIDER` to force the default, `AETHER_FAKE_PROVIDER=1` for offline dev, `NODE_ENV=production` to serve from `dist/`.
