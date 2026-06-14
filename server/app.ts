import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { isAppError } from './lib/errors';
import type { ContextStore } from './domain/context/context.store';
import type { HistoryStore } from './domain/history/history.store';
import type { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import type { FilesystemBrowserService } from '@/server/domain/workspaces/filesystem-browser.service';
import { createWorkspacesRoutes } from './routes/workspaces.routes';
import type { DispatchService } from './domain/dispatch/dispatch.service';
import type { ProfilesStore } from './domain/profiles/profiles.store';
import type { SubAgentsStore } from './domain/subagents/subagents.store';
import { createContextRoutes } from './routes/context.routes';
import { createDispatchRoutes } from './routes/dispatch.routes';
import { createHistoryRoutes } from './routes/history.routes';
import { createProfilesRoutes } from './routes/profiles.routes';
import { createSubAgentsRoutes } from './routes/subagents.routes';
import { createMcpRoutes } from '@/server/routes/mcp.routes';
import type { McpRegistry } from '@/server/domain/mcp/registry';
import { createProvidersRoutes } from '@/server/routes/providers.routes';
import type { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AuthStatusService } from '@/server/domain/providers/auth-status';
import type { KeyVaultService } from './domain/providers/key-vault';
import type { KeyVaultHooks } from './routes/providers.routes';
import { createSearchRoutes } from '@/server/routes/search.routes';
import type { SearchService } from '@/server/domain/search/search.service';
import { createGitRoutes } from '@/server/routes/git.routes';
import type { GitService } from '@/server/domain/git/git.service';
import { createSessionsRoutes } from './routes/sessions.routes';
import { createAttachmentsRoutes } from './routes/attachments.routes';
import type { BuiltinMcpStore } from '@/server/domain/mcp/builtin/builtin.store';
import { createBuiltinMcpRoutes } from './routes/builtin-mcp.routes';
import type { BreakpointPolicyStore } from '@/server/domain/mcp/breakpoints/policy.store';
import type { PreviewService } from '@/server/domain/mcp/breakpoints/preview.service';
import { createBreakpointsRoutes } from './routes/breakpoints.routes';
import type { OllamaEndpointStore } from '@/server/domain/providers/ollama-endpoints.store';
import { createSwarmRoutes } from './routes/swarms.routes';
import { createTddRoutes } from './routes/tdd.routes';
import { createScheduleRoutes } from './routes/schedules.routes';

export interface AppDeps {
  contextStore?: ContextStore;
  historyStore?: HistoryStore;
  workspacesStore?: WorkspacesStore;
  filesystemBrowser?: FilesystemBrowserService;
  dispatcher?: DispatchService;
  profilesStore?: ProfilesStore;
  subAgentsStore?: SubAgentsStore;
  mcpRegistry?: McpRegistry;
  builtinStore?: BuiltinMcpStore;
  providers?: ProviderRegistry;
  searchService?: SearchService;
  gitService?: GitService;
  authStatusService?: AuthStatusService;
  keyVault?: KeyVaultService;
  keyVaultHooks?: KeyVaultHooks;
  buildInfoRowsCtx?: { anthropicCliPresent: boolean; ollamaHost: string };
  ollamaEndpointStore?: OllamaEndpointStore;
  policyStore?: BreakpointPolicyStore;
  previewService?: PreviewService;
  swarmStore?: import('./domain/swarms/swarm.store').SwarmStore;
  swarmApprovals?: import('./domain/swarms/swarm.approval').SwarmApprovalRegistry;
  swarmOrchestratorDeps?: import('./domain/swarms/swarm.orchestrator').SwarmOrchestratorDeps;
  tddRunnerDeps?: import('./domain/tdd/tdd.types').TddRunnerDeps;
  scheduleStore?: import('./domain/schedules/schedules.store').ScheduleStore;
  scheduleRunner?: { run(s: import('./domain/schedules/schedules.types').Schedule): Promise<void> };
}

// In Express l'error middleware DEVE essere registrato dopo le route per
// catturare gli errori che esse generano. `extraRoutes` permette ai test
// (e in futuro a chi compone più moduli) di registrare route prima dell'error
// handler, evitando di riscrivere l'intera factory.
export function createApp(
  deps: AppDeps,
  extraRoutes?: (app: Express) => void,
): Express {
  const app = express();

  // Routes that need their own body parser (slice 16 import, slice 20 dispatch)
  // mount BEFORE the global 1 MB parser.
  if (deps.historyStore) {
    app.use('/api/sessions', createSessionsRoutes(deps.historyStore));
  }

  if (deps.dispatcher) {
    app.use('/api/ai/dispatch', createDispatchRoutes(deps.dispatcher));
  } else {
    app.post('/api/ai/dispatch', (_req, res) => {
      res.status(503).json({ error: { code: 'NO_DISPATCHER', message: 'Dispatcher not configured' } });
    });
  }

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  if (deps.contextStore) {
    app.use('/api/context', createContextRoutes(deps.contextStore));
  }

  if (deps.historyStore) {
    app.use('/api/attachments', createAttachmentsRoutes(deps.historyStore));
    app.use('/api/sessions', createHistoryRoutes(deps.historyStore, deps.workspacesStore));
  }

  if (deps.profilesStore) {
    app.use('/api/profiles', createProfilesRoutes(deps.profilesStore));
  }

  if (deps.subAgentsStore) {
    app.use('/api/subagents', createSubAgentsRoutes(deps.subAgentsStore));
  }

  if (deps.builtinStore && deps.mcpRegistry) {
    app.use('/api/mcp/builtin', createBuiltinMcpRoutes(deps.builtinStore, deps.mcpRegistry));
  }

  if (deps.mcpRegistry) {
    app.use('/api/mcp', createMcpRoutes(deps.mcpRegistry, deps.dispatcher));
  }

  if (deps.providers) {
    app.use(
      '/api/providers',
      createProvidersRoutes(
        deps.providers,
        deps.authStatusService,
        deps.keyVault,
        deps.keyVaultHooks,
        deps.buildInfoRowsCtx,
        deps.ollamaEndpointStore,
      ),
    );
  }

  if (deps.searchService) {
    app.use('/api/search', createSearchRoutes(deps.searchService));
  }

  if (deps.gitService) {
    app.use('/api/git', createGitRoutes(deps.gitService));
  }

  if (deps.policyStore && deps.previewService) {
    app.use(
      '/api/breakpoints',
      createBreakpointsRoutes({
        policyStore: deps.policyStore,
        previewService: deps.previewService,
      }),
    );
  }

  if (
    deps.workspacesStore &&
    deps.filesystemBrowser &&
    deps.historyStore &&
    deps.builtinStore &&
    deps.mcpRegistry
  ) {
    app.use(
      '/api/workspaces',
      createWorkspacesRoutes({
        store: deps.workspacesStore,
        browser: deps.filesystemBrowser,
        historyStore: deps.historyStore,
        builtinStore: deps.builtinStore,
        mcpRegistry: deps.mcpRegistry,
      }),
    );
  }

  if (deps.swarmStore && deps.swarmApprovals && deps.swarmOrchestratorDeps) {
    app.use(
      '/api/swarms',
      createSwarmRoutes(deps.swarmStore, deps.swarmOrchestratorDeps, deps.swarmApprovals),
    );
  }

  if (deps.tddRunnerDeps) {
    app.use('/api/tdd', createTddRoutes(deps.tddRunnerDeps));
  }

  if (deps.scheduleStore && deps.scheduleRunner) {
    app.use('/api/schedules', createScheduleRoutes(deps.scheduleStore, deps.scheduleRunner));
  }

  extraRoutes?.(app);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    // Express HTTP errors (e.g. 413 entity.too.large) carry a numeric `status`.
    if (typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
      const httpErr = err as { status: number; message?: string };
      res.status(httpErr.status).json({ error: { code: 'HTTP_ERROR', message: httpErr.message ?? 'HTTP error' } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'INTERNAL', message } });
  });

  return app;
}
