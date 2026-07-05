# Getting started

From zero to your first dispatch. When to read it: you've just cloned or installed Aether.

## Install

See the root [`README.md`](../README.md) for the one-liner installers (curl/PowerShell prebuilt tarball, or `npm`/`pnpm`/`bun` global install) and for **Run locally** (`npm install`, then `npm run dev`). This page picks up from there — it doesn't repeat the install steps.

## Explore with no keys

You don't need any API keys to try Aether. Run:

```bash
AETHER_FAKE_PROVIDER=1 npm run dev
```

This makes the built-in **Fake provider** the default. It streams a canned response (`pong`) with a short simulated "thinking about it…" phase and small artificial per-chunk delays, so you can exercise the full UI — dispatch, streaming, reasoning drawer, history — without any provider credentials (`server/domain/dispatch/providers/fake.provider.ts`, wired in `server/index.ts`).

## Enable a real provider

Once you're ready to use a real model, either:

- **Environment variables** — set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `OLLAMA_HOST` before starting the app, or
- **The in-app Provider Auth pane** — store a key encrypted in the local KeyVault without touching env vars.

Key resolution is env-first, then the vault. See [`guides/providers.md`](guides/providers.md) for how provider selection, key resolution, and vLLM/OpenAI-compatible endpoints work.

## Your first dispatch

1. Open <http://localhost:3000>.
2. Pick a provider in the TopBar's provider selector (this choice is "sticky" — it's saved on the session and becomes the default for new sessions).
3. Type a message and send it.

The response streams in as it's generated. If you enable "thinking" for a reasoning-capable provider, its intermediate reasoning shows up in the reasoning drawer; token usage (input/output) is reported once the turn completes (`server/domain/dispatch/dispatch.service.ts`).

## Where things live

By default, Aether's SQLite database lives at `./data/aether.sqlite` (relative to wherever the process is started). Override the directory with `AETHER_DATA_DIR` (`server/config.ts`). See [`reference/database.md`](reference/database.md) for the schema and migration model.

## Next

→ [`architecture.md`](architecture.md) — the mental model of the whole system.
