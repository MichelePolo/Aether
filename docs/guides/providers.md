# Providers

What this covers: how Aether discovers, credentials-gates, and names the model backends a session can dispatch to. Read this when you're adding a provider, debugging why a model isn't showing up in the selector, or wiring up an OpenAI-compatible endpoint (vLLM, LM Studio, etc.).

## How it works

Every backend implements the small `AIProvider` interface (`server/domain/dispatch/providers/provider.types.ts`): a `model` string, a `capabilities` object (`thinking`, `toolCalling`, `vision`), and a `stream()` method that yields `text` / `thinking` / `function_call` / `done` chunks. There are seven transports: `fake`, `gemini`, `ollama`, `anthropic`, `openai`, `openai-compat`, and `codex` (`ProviderTransport` in `server/domain/providers/registry.ts`).

`ProviderRegistry.refresh()` (`server/domain/providers/registry.ts`) rebuilds the whole provider map from scratch on every call:
- `fake:default` is always present.
- `gemini:<model>` and `openai:<model>` entries are added only when `resolveKey('gemini' | 'openai')` returns a key — i.e. the credential must resolve before the provider appears at all.
- `anthropic:<model>` depends on `detectAnthropicAuth()`: under `oauth` it lists the hardcoded model set; under `apikey` it calls `discoverAnthropic(key)` and only adds entries for models that come back (an empty result is recorded as a registry issue, not silently dropped).
- `ollama:<model>` entries come from **live discovery**: `listOllamaEndpoints()` returns configured endpoints, and each is probed via `discoverOllama(baseUrl, token, headers)`, which hits `<baseUrl>/api/tags`. The local endpoint keeps the legacy `ollama:<model>` naming for backward compatibility with sessions saved before multi-endpoint support; additional endpoints are namespaced `ollama:<endpointId>:<model>`.
- `openai-compat:<endpointId>:<model>` entries come from `listOpenAICompatEndpoints()` + `discoverOpenAICompat(baseUrl, headers)`, which hits `<baseUrl>/models` and falls back to the endpoint's configured `model` field if discovery returns nothing. openai-compat providers are **never** picked as the default — they must be selected manually.
- `codex:<model>` entries appear when `detectCodexAuth()` (`server/lib/codex-auth.ts`) finds the `codex` binary on PATH **and** `$CODEX_HOME/auth.json` (written by `codex login`, ChatGPT-subscription OAuth). No API key and no vault entry are involved — the CLI reads its own credentials. The model list is the hardcoded set plus the `model` from `~/.codex/config.toml`. At dispatch time `CodexProvider` spawns `codex exec --json` with a read-only sandbox and exposes Aether's MCP tools to it through a loopback MCP bridge (`/api/mcp-bridge/:token`), so tool calls still pass Aether's breakpoint gate and tracing.

Every entry's `name` (the registry map key, e.g. `gemini:gemini-1.5-pro` or `openai-compat:my-vllm:llama-3-70b`) is what a session's `providerName` field stores, and what the dispatch request body's `providerName` can override per call.

**Key resolution** is env-first: `KeyResolver.get()` (`server/domain/providers/key-resolver.ts`) checks `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` in `process.env` first, and only falls back to the encrypted vault (`KeyVaultService.getKey()`) if the env var is unset. See [Key vault](key-vault.md) for the encryption details.

**Default selection**: `ProviderRegistry.defaultName()` returns `deps.defaultOverride` (populated from `AETHER_DEFAULT_PROVIDER`, `server/index.ts`) if it names an entry that currently exists; otherwise it falls back through a fixed preference order — gemini, then openai, then anthropic, then ollama, then codex, then `fake:default` — picking the first entry found in each transport. openai-compat is deliberately excluded from this fallback chain; codex sits last among real transports so it never displaces an existing default but still beats the fake fallback.

**Sticky selection**: a session persists its own `providerName` (`src/stores/sessions.store.ts`); switching providers in the TopBar updates the active session's `providerName` and also writes a `localStorage` default so new sessions inherit the last choice.

**openai-compat endpoints** are managed from the Provider Auth pane: each endpoint has a `label`, `baseUrl`, optional pinned `model`, and optional custom headers. Headers are encrypted at rest (`OpenAICompatEndpointStore`, `server/domain/providers/openai-endpoints.store.ts`) using the same AES-256-GCM vault key as provider API keys; only header **keys**, never values, are exposed over the HTTP API (`OpenAICompatEndpointRecord.headerKeys`). Model discovery hits `/models` on the configured `baseUrl` (so a vLLM/LM Studio endpoint's `baseUrl` typically already includes `/v1`).

## Key files

- `server/domain/dispatch/providers/provider.types.ts` — the `AIProvider` interface and shared request/chunk types
- `server/domain/providers/registry.ts` — `ProviderRegistry`, transport list, default-selection logic
- `server/domain/providers/discovery.ts` — `discoverOllama`, `discoverOpenAICompat`, `discoverAnthropic`, hardcoded model lists
- `server/domain/providers/key-resolver.ts` — env-first `KeyResolver`
- `server/lib/codex-auth.ts` + `server/domain/dispatch/providers/codex.provider.ts` — Codex CLI detection and provider
- `server/domain/mcp/bridge/bridge.service.ts` + `server/routes/mcp-bridge.routes.ts` — loopback MCP bridge for agentic-CLI providers
- `server/domain/providers/openai-endpoints.store.ts` / `openai-endpoints.types.ts` — encrypted openai-compat endpoint config
- `src/stores/sessions.store.ts` — sticky per-session `providerName`

## See also

- [Key vault](key-vault.md) — how provider API keys are encrypted at rest
- [Architecture](../architecture.md) — where providers fit in the dispatch loop
- [Configuration](../reference/configuration.md) — `AETHER_DEFAULT_PROVIDER` and the provider env vars
