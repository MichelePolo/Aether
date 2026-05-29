# Aether Core

A local-first, multi-provider **agentic LLM dev studio**. Aether pairs a React single-page app with an Express + SQLite backend so you can drive multiple model providers, wire up MCP tools, gate dangerous tool calls behind approvals, and keep a fully persisted, forkable history — all from one workspace running on your machine.

> The whole stack runs from a single Node process: in development, Express serves the API and proxies the Vite dev server in middleware mode, so there's no separate frontend/backend to start.

## Features

- **Multi-provider runtime** — switch between **Gemini**, **Anthropic (Claude)**, **OpenAI**, and **Ollama** (local). Selection is sticky per session and survives reloads; concurrent dispatches on different providers run independently. A built-in **Fake provider** powers tests and offline dev.
- **Secure credential KeyVault** — store API keys encrypted in SQLite via the in-app Provider Auth pane, or supply them through environment variables. `KeyResolver` prefers env vars (12-factor) and falls back to the vault.
- **MCP tools** — connect any Model Context Protocol server, plus **1-click built-ins** (filesystem, terminal) you can toggle on/off without touching the CLI.
- **Agentic breakpoints** — let the agent run freely, but pause for an approval gate (with diff/preview) before irreversible actions.
- **Cross-model subagents** — dispatch subagents that can target different providers than the parent session.
- **Workspaces** — add and browse project folders through a GUI; Aether manages the underlying filesystem MCP for you.
- **History you control** — persisted sessions with **forking** (time-travel from any message), **JSON export/import** of full conversation trees, full-text search, a token/usage meter, and attachments (images + text docs stored as BLOBs).
- **Polished UX** — command palette, global keyboard shortcuts, reasoning drawer, profiles, and i18n.

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
              SQLite (better-sqlite3, migrations 001–009, FTS, BLOB attachments)
```

Server entrypoint: [`server/index.ts`](server/index.ts). Frontend entrypoint: [`src/main.tsx`](src/main.tsx).

## Run locally

**Prerequisites:** Node.js 20+ (better-sqlite3 needs a native build) and npm.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure at least one provider — either set environment variables (see below) or add keys later through the in-app **Provider Auth** pane. To explore the UI with no keys, run with the Fake provider: `AETHER_FAKE_PROVIDER=1 npm run dev`.
3. Start the app:
   ```bash
   npm run dev
   ```
   Then open http://localhost:3000.

### Configuration

These are the environment variables the code actually reads:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port for the server | `3000` |
| `AETHER_DATA_DIR` | Directory for the SQLite database | `./data` |
| `GEMINI_API_KEY` | Enable the Gemini provider | — |
| `ANTHROPIC_API_KEY` | Enable Anthropic/Claude (Claude CLI OAuth is also auto-detected) | — |
| `OPENAI_API_KEY` | Enable the OpenAI provider | — |
| `OLLAMA_HOST` | Ollama daemon URL (models are auto-discovered) | `http://localhost:11434` |
| `AETHER_DEFAULT_PROVIDER` | Force the default provider (e.g. `gemini:gemini-1.5-pro`) | — |
| `AETHER_FAKE_PROVIDER` | `1` to force the deterministic Fake provider | off |
| `NODE_ENV` | `production` serves the prebuilt SPA from `dist/` instead of Vite | — |

A provider only appears in the picker when its credential is present (or, for Ollama, when the daemon is reachable). Keys set in the in-app KeyVault are used when the matching env var is absent.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server (Express + Vite middleware) |
| `npm run build` | Build the SPA and bundle the server to `dist/server.cjs` |
| `npm start` | Run the production bundle (`NODE_ENV=production`) |
| `npm run lint` | Type-check with `tsc --noEmit` |
| `npm test` | Run unit/integration tests in watch mode (Vitest) |
| `npm run test:run` | Run tests once |
| `npm run test:coverage` | Run tests with coverage |
| `npm run test:e2e` | Run Playwright end-to-end tests |

## CLI (`aether`)

After `npm run build` (and `npm link` for a global `aether`):

```bash
aether daemon start            # start the background server (binds 127.0.0.1)
aether daemon status           # running/stopped + pid + port
aether daemon stop
aether "explain this stack trace"        # one-shot; creates a new session
aether --session <id> "follow-up"        # continue an existing session
cat error.log | aether "what went wrong?"   # stdin is appended to the prompt
aether --json "..."            # machine-readable JSONL events on stdout
```

In text mode stdout carries only the model's reply (pipe-friendly); the session
id, reasoning, and tool activity go to stderr. Sessions created by the CLI appear
in the web UI (shared SQLite). The daemon runs the built production bundle
(`dist/server.cjs`), so `npm run build` is a prerequisite for `aether daemon start`.
Gated MCP tool calls are auto-rejected in CLI runs (interactive approval is
web-UI only).

## Project layout

```
server/        Express app, domain services, SQLite db + migrations, MCP
src/           React app — components, Zustand stores, hooks, types, i18n
e2e/           Playwright tests
docs/          Architecture audits and design notes
data/          Local SQLite database (gitignored)
```
