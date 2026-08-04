# Aether documentation

A reading path, in order. Each step assumes the previous ones.

| # | Read | You'll learn |
|---|------|--------------|
| 1 | [Getting started](getting-started.md) | Install, first dispatch, enabling providers |
| 2 | [Architecture](architecture.md) | The single-process model, domain layer, dispatch loop |
| 3 | [Guides](#guides) | One deep-dive per domain — pick what you touch |
| 4 | [Reference](#reference) | Exact tables: env vars, API/SSE, database |
| 5 | [Development](development.md) | Tests, conventions, how changes land |

## Guides
- [Providers](guides/providers.md) — registry, key resolution, sticky selection, vLLM
- [Key vault](guides/key-vault.md) — encrypted credentials at rest
- [MCP tools](guides/mcp-tools.md) — connecting tool servers, built-ins, call caps
- [Built-in MCP deep dive](guides/builtin-mcp.md) — MCP primer & best practices, then how Filesystem, Terminal and Git are implemented
- [Breakpoints](guides/breakpoints.md) — approval gates on dangerous tool calls
- [Workspaces](guides/workspaces.md) — project folders and the filesystem MCP
- [History](guides/history.md) — sessions, forking, export/import, search
- [Subagents & swarms](guides/subagents-swarms.md) — cross-model delegation
- [Scheduler](guides/scheduler.md) — scheduled/background agents
- [CLI](guides/cli.md) — `aether` daemon and one-shot usage

## Reference
- [Configuration](reference/configuration.md) · [API & SSE](reference/api.md) · [Database](reference/database.md)

## Elsewhere
- [Contributing](../CONTRIBUTING.md) — how changes land (PR-only, squash)
- [Archive](archive/README.md) — historical audits (not current)
- [Design history](superpowers/README.md) — per-slice specs and plans
- 🇮🇹 [Documentazione in italiano](it/README.md)
