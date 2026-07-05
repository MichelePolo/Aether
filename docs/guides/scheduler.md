# Scheduler

What this covers: the background poller that fires scheduled prompts/swarms (cron or interval cadence) without any process outside the single Node server. Read this when you're debugging why a schedule didn't fire, changing timing constants, or manually exercising the feature.

## How it works

`SchedulerService` (`server/domain/schedules/scheduler.service.ts`) runs entirely inside the same Node process as the rest of the app — no external cron, no separate worker. `start()` fires one `tick()` immediately (boot catch-up, so a schedule whose `next_run_at` is already in the past when the server (re)starts gets a recovery run right away) and then a `setInterval` every **30 s** (`TICK_MS = 30_000`). Each tick asks the store for schedules that are due (`listDue(now)`), and for each one: advances `next_run_at` and `last_run_at` **before** firing the run (so a slow run can't be re-fired by the next tick), skips it if its `workspaceId` points at a workspace that no longer exists (logs a warning rather than silently falling back to the builtin filesystem root / `process.cwd()`), and skips it if a run for that schedule is still in flight (`running` set, keyed by schedule id — no overlapping runs of the same schedule).

**Minimum interval**: the `interval` cadence schema (`server/domain/schedules/schedules.schema.ts`) enforces `everyMs` ≥ **60 000 ms (1 minute)** via Zod. Combined with the 30 s tick, a freshly-created 1-minute schedule can take up to roughly **90 s** before its first automatic run — the poller only checks every 30 s, and the schedule itself won't be due for a full minute. Use the **▶ Run now** button (or `POST /api/schedules/:id/run`) for an instant run that bypasses the cadence entirely.

**Disabling**: setting `AETHER_SCHEDULER=0` skips `scheduler.start()` at boot (`server/index.ts`) — the poller never runs, but the `/api/schedules` routes stay mounted, so `Run now` and CRUD still work.

**Run ceiling**: `schedule-runner.ts` hard-caps a single run at **30 minutes** (`MAX_RUN_MS`), after which it's aborted.

**Target kinds**: a schedule's `target` is either `{ kind: 'prompt', prompt, subAgent? }` (see [Subagents & swarms](subagents-swarms.md) for how `subAgent` resolves) or `{ kind: 'swarm', swarmId, input? }`. Cadence is either `{ kind: 'cron', expr }` (validated by `isValidCron`) or `{ kind: 'interval', everyMs }`. The API lives under `/api/schedules` (`server/routes/schedules.routes.ts`, mounted in `server/app.ts`), backed by `ScheduleStore` and run by `ScheduleRunner`; each run's outcome is recorded (`success` / `error` / `rejected`, plus the `sessionId` it created) and retrievable via `GET /api/schedules/:id/runs`.

## Trying it out

A quick manual smoke test, no external services required:

1. Start with the deterministic fake provider: `AETHER_FAKE_PROVIDER=1 npm run dev`.
2. In the sidebar, open **Schedules** → **+ New**: name `smoke`, cadence `interval` every `60` minutes, target `prompt` with something like "Say hi and stop.", leave autonomy at **safe**, enable it, save.
3. Click **▶ Run now** on the `smoke` row.

Expected: a new session appears in the session list (the run creates it), and `GET /api/schedules/<id>/runs` shows a run with `status: "success"` and a populated `sessionId`. There is no run-history panel in the UI yet — inspect run outcomes via the `/runs` endpoint, the `schedule_runs` table, or by opening the session the run created.

To watch the poller fire on its own rather than using `Run now`, create a schedule with a 1-minute interval, don't click anything, and wait up to ~90 s — a `Run now`-free flow that exercises the cadence + the 30 s tick together, useful for confirming there's no double-fire (`next_run_at` advances before the run starts) and no overlap (a still-running schedule is skipped on the next tick).

## Key files

- `server/domain/schedules/scheduler.service.ts` — `SchedulerService`: the 30 s tick, boot catch-up, due-schedule loop
- `server/domain/schedules/schedules.schema.ts` — cadence/target validation, the 60 000 ms interval floor
- `server/domain/schedules/schedule-runner.ts` — `ScheduleRunner`, `MAX_RUN_MS` (30 min)
- `server/domain/schedules/schedules.store.ts` — `ScheduleStore`: CRUD, `listDue`, run history
- `server/routes/schedules.routes.ts` — `/api/schedules` CRUD, `/:id/run`, `/:id/runs`
- `server/index.ts` — `AETHER_SCHEDULER=0` gate around `scheduler.start()`

## See also

- [Subagents & swarms](subagents-swarms.md) — what a prompt- or swarm-target schedule actually dispatches
- [Workspaces](workspaces.md) — why a schedule skips its run when its workspace was deleted
- [Configuration](../reference/configuration.md) — `AETHER_SCHEDULER`, `AETHER_FAKE_PROVIDER`
