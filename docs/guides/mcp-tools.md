# MCP tools

What this covers: how MCP (Model Context Protocol) servers — custom or built-in — are connected, exposed to a dispatch, and capped. Read this when you're adding an MCP server, debugging why a tool isn't visible to the model, or tuning the per-dispatch tool-call limit.

## How it works

MCP servers are configured per workspace/context and connect over one of the transports implemented under `server/domain/mcp/`: `StdioMcpConnection` (spawns a child process, JSON-RPC over stdio), `HttpMcpConnection` (remote HTTP MCP server), and `MockMcpConnection` (tests). `McpRegistry` (`server/domain/mcp/registry.ts`) owns the live connections, calls `listLiveTools(root)` to enumerate the tools each connected server currently advertises, and exposes `callTool()` to invoke one.

**Built-in servers**: three transports ship as 1-click toggles, tracked in `BuiltinMcpStore` (`server/domain/mcp/builtin/builtin.store.ts`, `BuiltinTransport = 'filesystem' | 'terminal' | 'git'`):
- `filesystem` launches the official `@modelcontextprotocol/server-filesystem` package, rooted at the workspace.
- `terminal` launches Aether's own `aether-shell` MCP server as a separate Node process (dev runs it via `--import tsx`; production runs the bundled `dist/server/mcp/builtin/aether-shell.js` directly). Shell commands are subject to a blocklist (`BLOCKED_PATTERNS` — `rm -rf /`, `sudo`, fork bombs, `dd if=`, `mkfs.*`, raw disk writes, `chmod -R 777 /`) and defaults (`SHELL_DEFAULTS`: 30s timeout, 120s max, 1 MiB output cap).
- `git` launches `aether-git` the same way, for git-specific tool calls.

Each is enabled/disabled per workspace via `BuiltinMcpStore.setEnabled()`, and can be re-rooted to the active workspace path (`fs_root`) as the current workspace changes.

**Joining the dispatch**: at dispatch time, `DispatchService` calls `ensureRootedBuiltins(currentRoot)` then `listLiveTools(currentRoot)` to gather every currently-connected tool (built-in and custom), and passes them into `assemble()` (`server/domain/dispatch/prompt-assembler.ts`), which folds the tool declarations (`ProviderToolDecl[]`, from `provider.types.ts`) into the system instruction sent to the provider alongside context and any resolved subagent. Providers that run their own agentic loop (Anthropic via the Claude Agent SDK) invoke tools through a `runToolCall` callback the dispatch layer supplies; stateless REST providers instead yield `function_call` chunks that `runDispatchLoop()` intercepts.

**Per-dispatch call cap**: `runDispatchLoop()` (`server/domain/dispatch/dispatch.service.ts`) tracks `toolCallsCount` and stops executing further tool calls once it reaches `MAX_TOOL_CALLS_PER_DISPATCH`, which defaults to `DEFAULT_MAX_TOOL_CALLS_PER_DISPATCH = 25` and can be overridden via the `AETHER_MAX_TOOL_CALLS` environment variable (wired through `maxToolCallsPerDispatch` in the service deps). Once the cap is hit, further calls are rejected rather than executed, bounding a single dispatch's tool-call blast radius.

Every tool call — built-in or custom — is still subject to the approval gate described in [Breakpoints](breakpoints.md) before it actually runs.

## Key files

- `server/domain/mcp/registry.ts` — `McpRegistry`: live connections, `listLiveTools`, `callTool`, `policy`
- `server/domain/mcp/stdio-connection.ts` / `http-connection.ts` / `mock-connection.ts` — transport implementations
- `server/domain/mcp/builtin/builtin.store.ts` — built-in server enablement, blocklist, shell defaults
- `server/domain/mcp/builtin/builtin.types.ts` — `BuiltinTransport`, `BLOCKED_PATTERNS`, `SHELL_DEFAULTS`
- `server/domain/dispatch/prompt-assembler.ts` — `assemble()`, folds tool declarations into the system instruction
- `server/domain/dispatch/dispatch.service.ts` — `DEFAULT_MAX_TOOL_CALLS_PER_DISPATCH`, the tool-call loop

## See also

- [Breakpoints](breakpoints.md) — the approval gate every tool call passes through
- [Architecture](../architecture.md) — the dispatch loop and where tool assembly fits
- [Configuration](../reference/configuration.md) — `AETHER_MAX_TOOL_CALLS`
