# API & SSE reference

The REST surface and the SSE event vocabulary of the dispatch stream. When to read it: you're scripting against Aether or debugging a stream.

## Route groups

Route groups are mounted in `createApp()` (`../../server/app.ts`), each only when its backing dependency is present. This table lists the path prefix, its purpose, and the route file to read for exact request/response shapes — bodies are not repeated here.

| Path prefix | Purpose | Route file |
| --- | --- | --- |
| `/api/sessions` | Session CRUD (mounted with its own body parser) plus history endpoints for a session | [`server/routes/sessions.routes.ts`](../../server/routes/sessions.routes.ts), [`server/routes/history.routes.ts`](../../server/routes/history.routes.ts) |
| `/api/ai/dispatch` | The agentic dispatch loop, streamed over SSE; returns `503 NO_DISPATCHER` if no dispatcher is configured | [`server/routes/dispatch.routes.ts`](../../server/routes/dispatch.routes.ts) |
| `/api/health` | Liveness check, always mounted | `server/app.ts` |
| `/api/context` | Session/workspace context (files, notes) | [`server/routes/context.routes.ts`](../../server/routes/context.routes.ts) |
| `/api/attachments` | Upload/fetch message attachments | [`server/routes/attachments.routes.ts`](../../server/routes/attachments.routes.ts) |
| `/api/profiles` | Provider/model profile presets | [`server/routes/profiles.routes.ts`](../../server/routes/profiles.routes.ts) |
| `/api/subagents` | `@subagent` definitions | [`server/routes/subagents.routes.ts`](../../server/routes/subagents.routes.ts) |
| `/api/mcp/builtin` | Built-in MCP tool state | [`server/routes/builtin-mcp.routes.ts`](../../server/routes/builtin-mcp.routes.ts) |
| `/api/mcp` | MCP tool registry | [`server/routes/mcp.routes.ts`](../../server/routes/mcp.routes.ts) |
| `/api/skills` | Skills library | [`server/routes/skills.routes.ts`](../../server/routes/skills.routes.ts) |
| `/api/providers` | Provider registry, auth status, KeyVault, Ollama/OpenAI-compat endpoints | [`server/routes/providers.routes.ts`](../../server/routes/providers.routes.ts) |
| `/api/search` | Search over history/context | [`server/routes/search.routes.ts`](../../server/routes/search.routes.ts) |
| `/api/git` | Git operations against a workspace | [`server/routes/git.routes.ts`](../../server/routes/git.routes.ts) |
| `/api/breakpoints` | Tool-call approval/gate policy | [`server/routes/breakpoints.routes.ts`](../../server/routes/breakpoints.routes.ts) |
| `/api/workspaces` | Workspace registration and filesystem browsing | [`server/routes/workspaces.routes.ts`](../../server/routes/workspaces.routes.ts) |
| `/api/swarms` | Multi-agent swarm orchestration | [`server/routes/swarms.routes.ts`](../../server/routes/swarms.routes.ts) |
| `/api/tdd` | TDD runner | [`server/routes/tdd.routes.ts`](../../server/routes/tdd.routes.ts) |
| `/api/schedules` | Scheduled/cron jobs | [`server/routes/schedules.routes.ts`](../../server/routes/schedules.routes.ts) |

## SSE event vocabulary

The dispatch stream (`/api/ai/dispatch`, and its `resume()` continuation) is emitted via `SseEmitter` (`../../server/lib/sse.ts`), which writes standard `event: <name>\ndata: <json>\n\n` frames. Event names actually emitted by `DispatchService` (`../../server/domain/dispatch/dispatch.service.ts`):

| Event | Meaning |
| --- | --- |
| `text` | A chunk of assistant-visible text (`{ chunk }`) |
| `thinking` | A chunk of model "thinking"/reasoning text (`{ chunk }`) |
| `tool_call_request` | The model wants to call an MCP tool; includes a preview and is subject to `BreakpointService` gating (`{ ...call, preview }`) |
| `tool_call_started` | A tool call has begun executing (auto-approved or approved after a gate) |
| `tool_call_progress` | Incremental progress note for a long-running tool call (`{ id, note }`) |
| `tool_call_result` | The tool call finished (`{ id, ...result }`) |
| `done` | The dispatch turn finished; carries usage tokens |
| `error` | Something failed (`{ message, retryable }`); ends the stream |

The underlying provider-chunk vocabulary consumed by the dispatch loop (`ProviderChunk` in `../../server/domain/dispatch/providers/provider.types.ts`) is `text` / `thinking` / `function_call` / `done` — `function_call` is what becomes the `tool_call_*` SSE events above once the dispatch loop resolves it against breakpoint policy and executes it.

## Error shape

Every non-2xx JSON response uses the shape `{ error: { code, message } }`, produced by the error middleware registered last in `createApp()` (`../../server/app.ts`) from `AppError` / `ValidationError` / `NotFoundError` (`../../server/lib/errors.ts`). `AppError` carries a `status` (default `500`) and a `code` (default `INTERNAL`); `ValidationError` is `400 VALIDATION_ERROR`, `NotFoundError` is `404 NOT_FOUND`. Non-`AppError` exceptions with a numeric `status` (e.g. Express body-parser limits) are mapped to `{ error: { code: 'HTTP_ERROR', message } }`; anything else becomes `500 INTERNAL`.
