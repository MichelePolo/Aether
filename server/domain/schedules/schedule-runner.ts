import { DispatchService } from '@/server/domain/dispatch/dispatch.service';
import { runSwarm as realRunSwarm } from '@/server/domain/swarms/swarm.orchestrator';
import type { SseEmitter } from '@/server/lib/sse';
import type { ProviderRegistry } from '@/server/domain/providers/registry';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type { ContextStore } from '@/server/domain/context/context.store';
import type { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
import type { McpRegistry } from '@/server/domain/mcp/registry';
import type { BreakpointService } from '@/server/domain/mcp/breakpoints/breakpoints.service';
import type { SwarmStore } from '@/server/domain/swarms/swarm.store';
import type { SwarmApprovalRegistry } from '@/server/domain/swarms/swarm.approval';
import type { Schedule, Autonomy, RunStatus } from './schedules.types';

const MAX_RUN_MS = 30 * 60_000; // 30 min hard ceiling per run

/** A Proxy over the real registry that immediately rejects any gated tool call
 *  (so an unattended `safe` run never stalls 60s waiting for a human). */
function autoRejectGatedRegistry(registry: McpRegistry): McpRegistry {
  return new Proxy(registry, {
    get(target, prop, receiver) {
      if (prop === 'awaitDecision') return async () => 'reject' as const;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as McpRegistry;
}

const AUTO_GATE = { resolveDecision: async () => 'auto' as const } as unknown as BreakpointService;

interface RecordedSse { sse: SseEmitter; events: Array<{ name: string; data: unknown }> }
function recordingSse(): RecordedSse {
  const events: Array<{ name: string; data: unknown }> = [];
  return {
    events,
    sse: {
      event: (name, data) => { events.push({ name, data }); },
      error: (message) => { events.push({ name: 'error', data: { message } }); },
      end: () => {},
    },
  };
}

function outcome(events: Array<{ name: string; data: unknown }>): { status: RunStatus; error?: string } {
  const err = events.find((e) => e.name === 'error');
  if (err) return { status: 'error', error: String((err.data as { message?: unknown })?.message ?? 'error') };
  const sd = events.find((e) => e.name === 'swarm_done') as { data?: { status?: string } } | undefined;
  if (sd?.data?.status === 'error') return { status: 'error' };
  if (sd?.data?.status === 'rejected') return { status: 'rejected' };
  return { status: 'success' };
}

export interface ScheduleRunnerDeps {
  store: { createRun(id: string): string; setRunSession(runId: string, s: string): void; finishRun(runId: string, st: RunStatus, e?: string): void };
  historyStore: HistoryStore;
  contextStore?: ContextStore;
  providers?: ProviderRegistry;
  subAgentsStore?: SubAgentsStore;
  mcpRegistry?: McpRegistry;
  breakpointService?: BreakpointService;
  swarmStore?: SwarmStore;
  swarmApprovals?: SwarmApprovalRegistry;
  /** Test-only injection slot for swarm deps; the production path uses the granular
   *  `swarmStore`/`swarmApprovals`/`subAgentsStore` fields above. */
  swarmDeps?: unknown;
  /** Overridable for tests; defaults to building a real per-run DispatchService. */
  buildDispatcher?: (autonomy: Autonomy) => { handle: DispatchService['handle'] };
  /** Overridable for tests. */
  runSwarm?: typeof realRunSwarm;
}

export class ScheduleRunner {
  constructor(private readonly deps: ScheduleRunnerDeps) {}

  private buildDispatcher(autonomy: Autonomy): { handle: DispatchService['handle'] } {
    if (this.deps.buildDispatcher) return this.deps.buildDispatcher(autonomy);
    const registry = autonomy === 'trusted'
      ? this.deps.mcpRegistry
      : this.deps.mcpRegistry ? autoRejectGatedRegistry(this.deps.mcpRegistry) : undefined;
    const breakpointService = autonomy === 'trusted' ? AUTO_GATE : this.deps.breakpointService;
    return new DispatchService({
      providers: this.deps.providers!,
      historyStore: this.deps.historyStore,
      contextStore: this.deps.contextStore!,
      subAgentsStore: this.deps.subAgentsStore,
      mcpRegistry: registry,
      breakpointService,
    });
  }

  async run(schedule: Schedule): Promise<void> {
    const runId = this.deps.store.createRun(schedule.id);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MAX_RUN_MS);
    const rec = recordingSse();
    try {
      const dispatcher = this.buildDispatcher(schedule.autonomy);

      if (schedule.target.kind === 'prompt') {
        const session = await this.deps.historyStore.createEmpty({
          providerName: schedule.providerName, workspaceId: schedule.workspaceId,
        });
        this.deps.store.setRunSession(runId, session.id);
        const subAgent = schedule.target.subAgent;
        const message = subAgent ? `@${subAgent} ${schedule.target.prompt}` : schedule.target.prompt;
        await dispatcher.handle({ sessionId: session.id, message, providerName: schedule.providerName }, rec.sse, ctrl.signal);
      } else {
        let first: string | null = null;
        const createSession = async () => {
          const id = (await this.deps.historyStore.createEmpty({
            providerName: schedule.providerName, workspaceId: schedule.workspaceId,
          })).id;
          if (!first) { first = id; this.deps.store.setRunSession(runId, id); }
          return id;
        };
        const swarmId = schedule.target.swarmId;
        const input = schedule.target.input ?? '';
        await (this.deps.runSwarm ?? realRunSwarm)(
          {
            store: this.deps.swarmStore!,
            subAgentsStore: this.deps.subAgentsStore!,
            dispatcher,
            createSession,
            approvals: this.deps.swarmApprovals!,
          },
          { swarmId, input },
          rec.sse, ctrl.signal,
        );
      }

      const { status, error } = outcome(rec.events);
      this.deps.store.finishRun(runId, status, error);
    } catch (e) {
      this.deps.store.finishRun(runId, 'error', e instanceof Error ? e.message : 'run failed');
    } finally {
      clearTimeout(timer);
    }
  }
}
