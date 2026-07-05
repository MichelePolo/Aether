# Development

How to work on Aether: commands, test layout, conventions. When to read it: before your first PR.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Start Express + the Vite dev-server middleware on <http://localhost:3000> |
| `AETHER_FAKE_PROVIDER=1 npm run dev` | Same, but defaulting to the deterministic Fake provider (no API keys needed) |
| `npm run lint` | Type-check (`tsc --noEmit`) — this **is** the lint step; there is no ESLint |
| `npm run build` | `node scripts/build.mjs` — Vite build + esbuild bundle of the server to `dist/server.cjs` |
| `npm start` | Run the production bundle (`node dist/server.cjs`; expects `NODE_ENV=production`) |
| `npm test` | Vitest, watch mode |
| `npm run test:run` | Vitest, single run |
| `npm run test:coverage` | Vitest with v8 coverage (thresholds enforced — see below) |
| `npm run test:ui` | Vitest with the interactive UI |
| `npm run test:e2e` | Playwright e2e (`e2e/`), auto-starts the dev server |
| `npm run test:e2e:ui` | Playwright e2e with the Playwright UI |
| `npm run smoke:prod` | `node scripts/smoke-prod.mjs` |
| `npm run clean` | `node scripts/clean.mjs` |

## Test layout

Vitest runs **two projects**, defined in `vitest.config.ts`:

- **`frontend`** — `environment: 'jsdom'`, matches `src/**/*.{test,spec}.{ts,tsx}`, setup file `src/test/setup.ts`.
- **`backend`** — `environment: 'node'`, matches `server/**/*.{test,spec}.ts` and `cli/**/*.{test,spec}.ts`, setup file `server/test/setup.ts`.

Tests are colocated next to source as `*.test.ts(x)`. Vitest `globals` are on, so `describe`/`it`/`expect` need no import.

Coverage thresholds of **80%** (branches/functions/lines/statements) are enforced on: `server/domain/**`, `server/lib/**`, `cli/**`, `src/hooks/**`, `src/stores/**`, `src/lib/**`. Set `COVERAGE_NO_THRESHOLDS=1` to generate the coverage report (e.g. for the Codecov `lcov` upload in CI) without enforcing these thresholds — real test failures still fail the build.

### Focused-test recipes

```bash
npx vitest run server/domain/dispatch/dispatch.service.test.ts   # one file
npx vitest run -t "rejects unsupported MIME"                     # by test name
npx vitest run --project backend                                 # only the backend project
npx vitest run --project frontend                                # only the frontend project
```

## Import paths

`@/*` aliases the repo root (configured in `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts`). Imports are written from the root, e.g. `@/server/domain/...`, `@/src/stores/...`. TypeScript is strict, with `noUnusedLocals`/`noUnusedParameters` on; `noEmit` is set because Vite/esbuild — not `tsc` — produce the actual build output.

## Slice workflow

Work is organized as numbered **slices** on `feat/slice-N-*` branches (see `docs/superpowers/roadmap.md`); migration comments and tests reference slice numbers. New features go through the superpowers brainstorming → writing-plans → subagent-driven-development flow.

## `DISABLE_HMR`

`DISABLE_HMR=true` disables both Vite HMR and file watching. The conditional that implements this lives in `vite.config.ts`:

```ts
hmr: process.env.DISABLE_HMR !== 'true',
watch: process.env.DISABLE_HMR === 'true' ? null : {},
```

This exists so agent edits don't trigger a reload/flicker loop — it's intentional, not a bug to "fix".

## Language of comments and docs

Some code comments and the audits under `docs/archive/` are written in Italian. This is expected and not a signal to translate.

## Sending a PR

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for how changes land (PR-only, squash merge).
