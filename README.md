# Aether Core

> 🇬🇧 English · [🇮🇹 Italiano](docs/it/README.md)

[![codecov](https://codecov.io/gh/MichelePolo/Aether/branch/main/graph/badge.svg)](https://codecov.io/gh/MichelePolo/Aether)

A local-first, multi-provider **agentic LLM dev studio**. Aether pairs a React single-page app with an Express + SQLite backend so you can drive multiple model providers, wire up MCP tools, gate dangerous tool calls behind approvals, and keep a fully persisted, forkable history — all from one workspace running on your machine.

> The whole stack runs from a single Node process: in development, Express serves the API and proxies the Vite dev server in middleware mode, so there's no separate frontend/backend to start.

## Features

- **Multi-provider runtime** — switch between **Gemini**, **Anthropic (Claude)**, **OpenAI**, **OpenAI-compatible** endpoints (**vLLM** and any `/v1` server), and **Ollama** (local). Selection is sticky per session. A built-in **Fake provider** powers tests and offline dev.
- **Secure credential KeyVault** — store API keys encrypted in SQLite via the in-app Provider Auth pane, or supply them through environment variables.
- **MCP tools** — connect any Model Context Protocol server, plus **1-click built-ins** (filesystem, terminal) you can toggle on/off without touching the CLI.
- **Agentic breakpoints** — let the agent run freely, but pause for an approval gate (with diff/preview) before irreversible actions.
- **Cross-model subagents** — dispatch subagents that can target different providers than the parent session.
- **Workspaces** — add and browse project folders through a GUI; Aether manages the underlying filesystem MCP for you.
- **History you control** — persisted sessions with **forking**, **JSON export/import**, full-text search, a token/usage meter, and attachments.
- **Polished UX** — command palette, global keyboard shortcuts, reasoning drawer, profiles, and i18n.

## Install (one-liner)

**Prerequisite:** Node.js 22+ (the install downloads a prebuilt tarball;
`better-sqlite3` fetches a prebuilt native binary on most platforms — no build
toolchain needed).

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.sh | bash

# Windows (PowerShell)
powershell -c "irm https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.ps1 | iex"

# npm / pnpm / bun  (then: aether daemon start --open)
npm  i   -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz
pnpm add -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz
bun  add -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz
```

The curl/PowerShell scripts check Node, install the latest prebuilt release, then
run `aether daemon start --open` (starts the local server and opens the browser).
The npm/pnpm/bun commands install the same tarball; afterwards run
`aether daemon start --open` yourself. To build from a clone instead, see
**Run locally** below.

## Run locally

**Prerequisites:** Node.js 22+ (better-sqlite3 fetches a prebuilt native binary) and npm.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure at least one provider — either set environment variables or add keys later through the in-app **Provider Auth** pane. To explore the UI with no keys, run with the Fake provider: `AETHER_FAKE_PROVIDER=1 npm run dev`. See [`docs/reference/configuration.md`](docs/reference/configuration.md) for the full environment variable reference.
3. Start the app:
   ```bash
   npm run dev
   ```
   Then open http://localhost:3000.

For scripts (`npm run build`, `npm test`, …) see [`docs/development.md`](docs/development.md). For the `aether` CLI, see [`docs/guides/cli.md`](docs/guides/cli.md).

## Documentation

Start here: **[`docs/README.md`](docs/README.md)**.

From there, the docs follow this path:

1. [Getting started](docs/getting-started.md)
2. [Architecture](docs/architecture.md)
3. [Guides](docs/guides/)
4. [Reference](docs/reference/)

The rendered docs are also published as a minisite: <https://michelepolo.github.io/Aether>.

## Tech stack

| Layer | Tools |
| --- | --- |
| Frontend | React 19, Vite 6, Zustand, Tailwind CSS 4, lucide-react, motion, react-markdown, cmdk |
| Backend | Node.js, Express 4, better-sqlite3, Zod; `tsx` in dev, `esbuild` bundle for prod |
| LLM / agents | `@anthropic-ai/claude-agent-sdk`, `@google/genai`, OpenAI & Ollama over HTTP |
| MCP | `@modelcontextprotocol/server-filesystem` + custom servers |
| Testing | Vitest, Testing Library, Playwright (e2e), MSW, supertest |

## Architecture

```
React SPA (Zustand stores, SSE streaming)
        │  REST + Server-Sent Events
        ▼
Express API  ──►  Domain layer
                   ├─ dispatch      (agentic loop, attachment preprocessing)
                   ├─ providers     (ProviderRegistry + KeyResolver + KeyVault)
                   ├─ mcp           (registry, built-ins, breakpoints/policy)
                   ├─ history       (sessions, forking, export/import)
                   ├─ context · profiles · subagents · search · workspaces · reasoning
                   ▼
              SQLite (better-sqlite3, numbered migrations, FTS, BLOB attachments)
```

Server entrypoint: [`server/index.ts`](server/index.ts). Frontend entrypoint: [`src/main.tsx`](src/main.tsx).

## Project layout

```
server/        Express app, domain services, SQLite db + migrations, MCP
src/           React app — components, Zustand stores, hooks, types, i18n
e2e/           Playwright tests
docs/          Documentation — start at docs/README.md
data/          Local SQLite database (gitignored)
```
