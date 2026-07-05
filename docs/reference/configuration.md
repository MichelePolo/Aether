# Configuration

Every environment variable Aether reads, with defaults. All are optional. When to read it: you're configuring a deployment or enabling a provider.

These are the environment variables the code actually reads:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port for the server | `3000` |
| `AETHER_DATA_DIR` | Directory for the SQLite database | `./data` |
| `AETHER_HOST` | Address the server binds to; set to `0.0.0.0` to expose Aether on your LAN (anyone on the network can then drive dispatch and tools) | `127.0.0.1` |
| `AETHER_VAULT_KEY` | Override the vault key that encrypts provider credentials in SQLite (64 hex chars = 32 bytes) | random, persisted at `${AETHER_DATA_DIR}/.vault.key` |
| `AETHER_LIBRARY_DIR` | Directory for skills (and future agents) | OS app-data dir |
| `GEMINI_API_KEY` | Enable the Gemini provider | — |
| `ANTHROPIC_API_KEY` | Enable Anthropic/Claude (Claude CLI OAuth is also auto-detected) | — |
| `CLAUDE_CODE_OAUTH_TOKEN` | Anthropic OAuth/Teams without an API key — generate via `claude setup-token`; passed explicitly to the spawned agent so dispatch authenticates under isolation | — |
| `OPENAI_API_KEY` | Enable the OpenAI provider | — |
| `OLLAMA_HOST` | Ollama daemon URL (models are auto-discovered) | `http://localhost:11434` |
| `AETHER_DEFAULT_PROVIDER` | Force the default provider (e.g. `gemini:gemini-1.5-pro`) | — |
| `AETHER_FAKE_PROVIDER` | `1` to force the deterministic Fake provider | off |
| `AETHER_MAX_TOOL_CALLS` | Max MCP tool calls executed per dispatch before further calls are rejected (raise for heavy file-reading sessions) | `25` |
| `AETHER_DAEMON` | `1` marks the process as the background daemon: on listen it writes a daemon file (pid, host, port, start time) under `AETHER_DATA_DIR` | off |
| `AETHER_SCHEDULER` | `0` disables starting the schedules runner on boot | on |
| `AETHER_BUILTIN_POOL_MAX` | Max size of the built-in MCP connection pool (positive integer; invalid values fall back to the default) | `8` |
| `NODE_ENV` | `production` serves the prebuilt SPA from `dist/` instead of Vite | — |

A provider only appears in the picker when its credential is present (or, for Ollama, when the daemon is reachable). Keys set in the in-app KeyVault are used when the matching env var is absent.

**OpenAI-compatible (vLLM) endpoints** are added from the **Provider Auth** pane, not via env vars: give a `/v1` base URL plus any custom auth headers (e.g. `Authorization: Bearer …`, `X-API-Key: …`). Headers are encrypted at rest (AES-256-GCM) and never returned in plaintext by the API. Models are auto-discovered from `/v1/models`; each becomes selectable as `openai-compat:<endpoint>:<model>`. The same custom-header support is also available on Ollama endpoints.

## See also

- [`../guides/providers.md`](../guides/providers.md)
- [`../guides/key-vault.md`](../guides/key-vault.md)
