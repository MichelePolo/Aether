# Architecture

The mental model of the whole system, for humans and AI agents. When to read it: before changing anything non-trivial.

```
React SPA (Zustand stores, SSE streaming)
        │  REST + Server-Sent Events
        ▼
Express API  ──►  Domain layer
                   ├─ dispatch      (agentic loop, attachment preprocessing)
                   ├─ providers     (ProviderRegistry + KeyResolver + KeyVault)
                   ├─ mcp           (registry, built-ins, breakpoints/policy)
                   ├─ history       (sessions, forking, export/import)
                   ├─ context · profiles · subagents · swarms · schedules · skills
                   ├─ search · workspaces · reasoning · git · tdd
                   ▼
              SQLite (better-sqlite3, numbered migrations, FTS, BLOB attachments)
```

## 1. One process

The whole stack runs from a single Node process. In development, `bootstrap()` (`server/index.ts`) builds an Express app and, when `NODE_ENV !== 'production'`, creates a Vite dev server in **middleware mode** and mounts it (`app.use(vite.middlewares)`) — there is no separate frontend server, no proxy, one port. In production, the prebuilt SPA is served directly: `express.static(distPath)` plus a catch-all `app.get('*', ...)` that returns `index.html`, with `distPath` resolved relative to the bundled `server.cjs` (not `process.cwd()`), so the daemon works regardless of the directory it's launched from.

## 2. Composition root

`server/index.ts`'s `bootstrap()` is the composition root: it opens the database, applies migrations, constructs every store/service/provider (context, history, profiles, subagents, workspaces, MCP registry, breakpoint service, provider registry, dispatcher, swarms, schedules, skills, …), and hands them all to `createApp(deps)` (`server/app.ts`).

`createApp` takes an `AppDeps` object whose fields are **all optional**, and mounts each route group only if its dependency is present, e.g.:

```ts
if (deps.dispatcher) {
  app.use('/api/ai/dispatch', createDispatchRoutes(deps.dispatcher));
}
```

This is exactly why unit tests can build a minimal app wired with just the one or two deps they exercise, instead of standing up the entire backend. The error-handling middleware is registered **last**, after all route groups and any `extraRoutes` hook, so it can catch errors from every route (`AppError`/`ValidationError` from `server/lib/errors.ts` serialize to `{ error: { code, message } }` with the matching HTTP status).

## 3. Domain layer

Each feature lives under `server/domain/<feature>/`. As of this writing the folders are: `context`, `dispatch`, `git`, `history`, `mcp`, `profiles`, `providers`, `reasoning`, `schedules`, `search`, `skills`, `subagents`, `swarms`, `tdd`, `workspaces`. Each typically pairs a SQLite-backed `*.store.ts`, a `*.service.ts`, `*.types.ts`, and a `createXxxRoutes()` factory consumed by `server/app.ts` (routes themselves live under `server/routes/*.routes.ts`).

## 4. Dispatch loop

`DispatchService.handle()` (`server/domain/dispatch/dispatch.service.ts`) is the heart of the app. It:

1. **Resolves the provider**: request body `providerName` → a matched `@subagent`'s model → the session's stored `providerName` → the registry's default (`providers.defaultName()`).
2. **Reads context**, resolves a leading `@subagent` mention (`parseLeadingMention`), and preprocesses attachments — text files are inlined into the user message as fenced code blocks, images are only forwarded to vision-capable providers, and the whole attachment set is capped at 10 MB total (`preprocessAttachments`, `MAX_TOTAL_BYTES`).
3. **Assembles** the system instruction and tool declarations from stored context, the resolved subagent, active skills, and the live MCP tools rooted at the session's workspace (`assemble()` in `prompt-assembler`).
4. **Runs the streaming loop** (`runDispatchLoop`): iterates the provider's `stream()` async generator, forwarding `text` / `thinking` / `function_call` / `done` chunks out over SSE. Each MCP tool call goes through `gateExecuteAndTrace`, which previews the call, asks `BreakpointService` for a decision (`auto` → run immediately, `gate` → await a user approve/reject decision with a 24h timeout), executes it via `McpRegistry.callTool`, and records the outcome. Tool calls are capped per dispatch (`DEFAULT_MAX_TOOL_CALLS_PER_DISPATCH = 25`, overridable via `AETHER_MAX_TOOL_CALLS`/`maxToolCallsPerDispatch`).
5. **Traces and persists**: `ReasoningTracer` records each step (context fetch, subagent resolution, dispatch, tool calls, validation); the user message and the resulting model message — including usage tokens, reasoning steps, and an `interrupted` flag — are appended to `HistoryStore`.

`resume()` follows the same shape to continue a message that was previously interrupted (client disconnect or abort), replaying only the history up to that message and picking up from its partial text (`pendingAssistantText`).

## 5. Persistence

Aether uses `better-sqlite3` (synchronous) with a single database file at `${AETHER_DATA_DIR}/aether.sqlite`. Schema evolves through append-only, numbered migration files applied in order at boot. See [`reference/database.md`](reference/database.md) for the full file layout, migration list, FTS setup, and cascade rules.

## 6. Frontend

The React 19 SPA keeps one Zustand store per domain under `src/stores/*.store.ts`. Stores never call `fetch` directly — they go through thin API clients in `src/lib/api/*.api.ts`. The common store pattern is an **optimistic update followed by the API call, rolling back to the previous value on error** (see `src/stores/context.store.ts`). Streaming dispatch is driven by `src/hooks/useStreamingDispatch.ts`, which consumes SSE events parsed by `src/lib/sse-parser.ts` and updates the chat/sessions/providers/ui stores as `text`, `thinking`, tool-call, and `done` events arrive.

## Next

→ [`development.md`](development.md) — commands, test layout, and conventions for working on this codebase.
