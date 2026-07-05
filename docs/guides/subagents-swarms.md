# Subagents & swarms

What this covers: how a leading `@subagent` mention is resolved into a dispatch, the seeded `skill-smith` subagent, and how swarms chain subagents across multiple steps with per-step approval. Read this when you're adding a subagent, debugging why `@name` didn't resolve, or working on multi-step swarm runs.

## How it works

**Subagents** are stored records (`SubAgentRecord`: `name`, `systemInstruction`, `skills`, `tools`, optional `model`) in `SubAgentsStore` (`server/domain/subagents/subagents.store.ts`). `model`, when set, is a `transport:model` provider override — a subagent can target a different provider than the session it's invoked from.

At dispatch time, `DispatchService.handle()` (`server/domain/dispatch/dispatch.service.ts`) parses a leading `@name` mention off the user message with `parseLeadingMention()` (`server/domain/dispatch/subagent-parser.ts`), then looks it up against every subagent record via `subAgentsStore.list()`/`read()`. On a match it emits a `resolve_subagent` reasoning step, and provider selection becomes: request body `providerName` → **matched subagent's `model`** → session's `providerName` → registry default. The subagent's `systemInstruction`/`skills`/`tools` are folded into the assembled prompt the same way the workspace/context system instruction is (see [MCP tools](mcp-tools.md) for how tool declarations join in).

**`skill-smith`** (`server/domain/subagents/skill-smith.ts`) is a subagent seeded once at boot if no subagent named `skill-smith` already exists (`seedSkillSmith()`, idempotent — it never overwrites a user's edited copy). Its system instruction walks the model through a fixed process: read the bundled `brainstorming` skill and interview the user one question at a time, then read `skill-creator` to generate the files, writing only under a `.drafts/<slug>/` folder inside the skills directory — never elsewhere — and handing off to the user to review/promote from the Skills panel rather than enabling the skill itself.

**Swarms** are a separate multi-step orchestration on top of subagents: a `SwarmRecord` (`server/domain/swarms/swarm.types.ts`) has an ordered list of `SwarmStep`s, each naming a `subAgentName`, a `promptTemplate`, an optional per-step `providerName`/`workspaceId` override, and a `pauseAfter` flag. `swarm.orchestrator.ts` runs the steps in sequence, feeding each step's output forward as the next step's input, and emits SSE progress (`swarm_approval_request`, `swarm_done` with `status: 'done' | 'rejected' | 'error' | 'interrupted'`). When a step has `pauseAfter: true`, the orchestrator emits `swarm_approval_request` and blocks on `SwarmApprovalRegistry.awaitDecision()` (`server/domain/swarms/swarm.approval.ts`) — resolved by an explicit approve/reject, by a configurable timeout (default 24h, passed as `approvalTimeoutMs`), or by the request's `AbortSignal` firing; the latter two both resolve to `'reject'` so a disconnected client doesn't leave a pending approval hanging for the full timeout.

## Key files

- `server/domain/subagents/subagents.store.ts` — `SubAgentsStore`: CRUD for subagent records
- `server/domain/subagents/subagents.types.ts` — `SubAgentRecord` (`model` provider override), `SubAgentMeta`
- `server/domain/subagents/skill-smith.ts` — `seedSkillSmith`, the skill-smith system instruction
- `server/domain/dispatch/subagent-parser.ts` — `parseLeadingMention`
- `server/domain/dispatch/dispatch.service.ts` — mention resolution, provider-selection precedence
- `server/domain/swarms/swarm.types.ts` — `SwarmRecord`, `SwarmStep`, `SwarmRunStatus`
- `server/domain/swarms/swarm.orchestrator.ts` — the step-by-step run loop, SSE events
- `server/domain/swarms/swarm.approval.ts` — `SwarmApprovalRegistry.awaitDecision`/`resolveDecision`

## See also

- [MCP tools](mcp-tools.md) — how a resolved subagent's tools join the assembled prompt
- [Providers](providers.md) — provider-selection precedence and per-provider capabilities
- [Scheduler](scheduler.md) — schedules can target either a prompt (with an optional subagent) or a swarm
