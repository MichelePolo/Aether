# Subagents & swarms

What this covers: how a leading `@subagent` mention is resolved into a dispatch, the seeded `skill-smith` subagent, and how swarms chain subagents across multiple steps with per-step approval. Read this when you're adding a subagent, debugging why `@name` didn't resolve, or working on multi-step swarm runs.

## How it works

**Subagents** are stored records (`SubAgentRecord`: `name`, `systemInstruction`, `skills`, `tools`, optional `model`) in `SubAgentsStore` (`server/domain/subagents/subagents.store.ts`). `model`, when set, is a `transport:model` provider override — a subagent can target a different provider than the session it's invoked from.

At dispatch time, `DispatchService.handle()` (`server/domain/dispatch/dispatch.service.ts`) parses a leading `@name` mention off the user message with `parseLeadingMention()` (`server/domain/dispatch/subagent-parser.ts`), then looks it up against every subagent record via `subAgentsStore.list()`/`read()`. On a match it emits a `resolve_subagent` reasoning step, and provider selection becomes: request body `providerName` → **matched subagent's `model`** → session's `providerName` → registry default. The subagent's `systemInstruction`/`skills`/`tools` are folded into the assembled prompt the same way the workspace/context system instruction is (see [MCP tools](mcp-tools.md) for how tool declarations join in).

**`skill-smith`** (`server/domain/subagents/skill-smith.ts`) is a subagent seeded once at boot if no subagent named `skill-smith` already exists (`seedSkillSmith()`, idempotent — it never overwrites a user's edited copy). Its system instruction is assembled by `skillSmithInstruction()` from two halves: the **portable agent body**, read from `bundle/sources/agent.md`, and an Aether-only appendix covering placement (write under `.drafts/<slug>/`, never elsewhere) and hand-off (the user reviews and promotes from the Skills panel; the subagent never enables a skill itself). The portable half deliberately carries no method — it tells the model to read the bundled `skill-smith` skill and follow it, with `brainstorming` used for the design step.

That split exists because the same agent ships outside Aether. `scripts/build-bundle.mjs` assembles `bundle/skill-smith/` — a Claude Code plugin holding `agents/skill-smith.md` (the same file Aether seeds, byte for byte) plus `skills/skill-smith/` (the same directory Aether seeds as a default skill, plus `agents/openai.yaml` for Codex). The bundle is generated *and* committed: `npm run bundle` regenerates it, `npm run bundle:check` fails when the committed copy has drifted from its sources, and `npm run bundle -- --zip` produces the skill-only archive that claude.ai and the Skills API accept. Install targets and their layouts are documented in `bundle/skill-smith/README.md`. In production the agent file is read from `dist/agents/skill-smith.md`, copied there by `scripts/build.mjs`.

**Swarms** are a separate multi-step orchestration on top of subagents: a `SwarmRecord` (`server/domain/swarms/swarm.types.ts`) has an ordered list of `SwarmStep`s, each naming a `subAgentName`, a `promptTemplate`, an optional per-step `providerName`/`workspaceId` override, and a `pauseAfter` flag. `swarm.orchestrator.ts` runs the steps in sequence, feeding each step's output forward as the next step's input, and emits SSE progress (`swarm_approval_request`, `swarm_done` with `status: 'done' | 'rejected' | 'error' | 'interrupted'`). When a step has `pauseAfter: true`, the orchestrator emits `swarm_approval_request` and blocks on `SwarmApprovalRegistry.awaitDecision()` (`server/domain/swarms/swarm.approval.ts`) — resolved by an explicit approve/reject, by a configurable timeout (default 24h, passed as `approvalTimeoutMs`), or by the request's `AbortSignal` firing; the latter two both resolve to `'reject'` so a disconnected client doesn't leave a pending approval hanging for the full timeout.

## Key files

- `server/domain/subagents/subagents.store.ts` — `SubAgentsStore`: CRUD for subagent records
- `server/domain/subagents/subagents.types.ts` — `SubAgentRecord` (`model` provider override), `SubAgentMeta`
- `server/domain/subagents/skill-smith.ts` — `seedSkillSmith`, `skillSmithInstruction`: the portable agent body plus the Aether appendix
- `bundle/sources/` — the hand-written half of the exportable bundle: agent, plugin manifest, Codex config, README
- `scripts/build-bundle.mjs` — assembles `bundle/skill-smith/`; `--check` guards against drift, `--zip` packages the skill
- `server/domain/dispatch/subagent-parser.ts` — `parseLeadingMention`
- `server/domain/dispatch/dispatch.service.ts` — mention resolution, provider-selection precedence
- `server/domain/swarms/swarm.types.ts` — `SwarmRecord`, `SwarmStep`, `SwarmRunStatus`
- `server/domain/swarms/swarm.orchestrator.ts` — the step-by-step run loop, SSE events
- `server/domain/swarms/swarm.approval.ts` — `SwarmApprovalRegistry.awaitDecision`/`resolveDecision`

## See also

- [MCP tools](mcp-tools.md) — how a resolved subagent's tools join the assembled prompt
- [Providers](providers.md) — provider-selection precedence and per-provider capabilities
- [Scheduler](scheduler.md) — schedules can target either a prompt (with an optional subagent) or a swarm
