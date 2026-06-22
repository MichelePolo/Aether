import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { writeDaemonFile, clearDaemonFile } from './lib/daemon-file';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/database';
import { applyMigrations } from './db/migrate';
import { ContextStore } from './domain/context/context.store';
import { HistoryStore } from './domain/history/history.store';
import { ProfilesStore } from './domain/profiles/profiles.store';
import { SubAgentsStore } from './domain/subagents/subagents.store';
import { WorkspacesStore } from './domain/workspaces/workspaces.store';
import { FilesystemBrowserService } from './domain/workspaces/filesystem-browser.service';
import { DispatchService } from './domain/dispatch/dispatch.service';
import { FakeProvider } from './domain/dispatch/providers/fake.provider';
import { GeminiProvider } from './domain/dispatch/providers/gemini.provider';
import { McpRegistry } from './domain/mcp/registry';
import { BuiltinMcpStore } from './domain/mcp/builtin/builtin.store';
import { BreakpointPolicyStore } from './domain/mcp/breakpoints/policy.store';
import { PreviewService } from './domain/mcp/breakpoints/preview.service';
import { BreakpointService } from './domain/mcp/breakpoints/breakpoints.service';
import { ProviderRegistry } from './domain/providers/registry';
import { OllamaProvider } from './domain/dispatch/providers/ollama.provider';
import { AnthropicProvider } from './domain/dispatch/providers/anthropic.provider';
import { OpenAIProvider } from './domain/dispatch/providers/openai.provider';
import { detectAnthropicAuth } from './lib/anthropic-auth';
import { SearchService } from './domain/search/search.service';
import { GitService } from './domain/git/git.service';
import { AuthStatusService } from './domain/providers/auth-status';
import { KeyVaultService } from './domain/providers/key-vault';
import { KeyResolver } from './domain/providers/key-resolver';
import { OllamaEndpointStore } from './domain/providers/ollama-endpoints.store';
import { OpenAICompatEndpointStore } from './domain/providers/openai-endpoints.store';
import { SwarmStore } from './domain/swarms/swarm.store';
import { SwarmApprovalRegistry } from './domain/swarms/swarm.approval';
import { ScheduleStore } from './domain/schedules/schedules.store';
import { ScheduleRunner } from './domain/schedules/schedule-runner';
import { SchedulerService } from './domain/schedules/scheduler.service';
import { createRunCommand } from './domain/tdd/tdd.run-command';
import { executeCommand } from './mcp/builtin/aether-shell.handler';
import { SkillStateStore } from './domain/skills/skill-state.store';
import { SkillsService } from './domain/skills/skills.service';
import { seedDefaultSkills } from './domain/skills/seed';
import { seedSkillSmith } from './domain/subagents/skill-smith';
import { defaultsDir, skillsDirFor, agentsDirFor } from './domain/skills/skills.paths';
import { relocateSkillsDir } from './domain/skills/relocate';
import { assertWritableDir } from './lib/library-dir';

dotenv.config();

async function bootstrap() {
  const cfg = loadConfig();

  const db = openDatabase(path.join(cfg.dataDir, 'aether.sqlite'));
  const migrated = applyMigrations(db, path.join(__dirname, 'db', 'migrations'));
  if (migrated.applied.length > 0) {
    console.log(`[db] applied migrations: ${migrated.applied.join(', ')}`);
  }

  assertWritableDir(cfg.libraryDir);
  if (relocateSkillsDir(cfg.dataDir, cfg.libraryDir)) {
    console.log(`[skills] relocated skills dir to ${skillsDirFor(cfg.libraryDir)}`);
  }
  mkdirSync(agentsDirFor(cfg.libraryDir), { recursive: true });
  seedDefaultSkills(defaultsDir(), skillsDirFor(cfg.libraryDir));

  const contextStore = new ContextStore(db);
  const historyStore = new HistoryStore(db);
  const profilesStore = new ProfilesStore(db);
  const subAgentsStore = new SubAgentsStore(db);
  await seedSkillSmith(subAgentsStore);
  const searchService = new SearchService(db);

  const builtinStore = new BuiltinMcpStore(db, cfg.libraryDir);
  const mcpRegistry = new McpRegistry(contextStore, builtinStore);

  const policyStore = new BreakpointPolicyStore(db);
  const previewService = new PreviewService({
    safeRoots: () => {
      const fsRoot = builtinStore.read().find((r) => r.transport === 'filesystem')?.fsRoot;
      return [process.cwd(), ...(fsRoot ? [fsRoot] : [])];
    },
    // Mirror toConfigs' defaultCwd fallback so the preview reflects the cwd the
    // git MCP actually runs in (process.cwd()) when git is enabled but unrooted.
    gitRoot: () => builtinStore.read().find((r) => r.transport === 'git')?.fsRoot ?? process.cwd(),
  });
  const breakpointService = new BreakpointService({ mcpRegistry, policyStore });

  const workspacesStore = new WorkspacesStore(db);
  const filesystemBrowser = new FilesystemBrowserService();
  const gitService = new GitService(workspacesStore);

  const fakeProvider = new FakeProvider({
    chunks: ['pong'],
    thoughtChunks: ['thinking about it…'],
    chunkDelayMs: 50,
    model: 'fake-1',
  });

  if (cfg.fakeProvider) {
    console.log('[aether] Using FakeProvider (AETHER_FAKE_PROVIDER=1)');
  }

  const keyVault = new KeyVaultService(db);

  // Cold-start anthropic env priming: if vault has an anthropic key and env doesn't,
  // set process.env.ANTHROPIC_API_KEY BEFORE detectAnthropicAuth() runs so the SDK sees it.
  if (!process.env.ANTHROPIC_API_KEY) {
    const stored = keyVault.getKey('anthropic');
    if (stored) process.env.ANTHROPIC_API_KEY = stored;
  }

  const resolver = new KeyResolver({
    vault: keyVault,
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: cfg.openAIApiKey || undefined,
      GEMINI_API_KEY: cfg.geminiApiKey || undefined,
    },
  });

  const ollamaHost = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

  const ollamaEndpointStore = new OllamaEndpointStore(db);
  const listOllamaEndpoints = () => [
    { id: 'local', label: 'local', baseUrl: ollamaHost },
    ...ollamaEndpointStore.listResolved(),
  ];

  const openAICompatEndpointStore = new OpenAICompatEndpointStore(db);
  const listOpenAICompatEndpoints = () => openAICompatEndpointStore.listResolved();

  const providers = new ProviderRegistry({
    resolveKey: (t) => resolver.get(t),
    detectAnthropicAuth,
    fakeProvider,
    geminiBuilder: (model) => new GeminiProvider({ apiKey: resolver.get('gemini') ?? '', model }),
    listOllamaEndpoints,
    ollamaBuilder: (baseUrl, model, token) => new OllamaProvider({ host: baseUrl, model, token }),
    anthropicBuilder: (model) =>
      new AnthropicProvider({
        model,
        // Hand auth to the isolated `claude` explicitly (settingSources:[] stops
        // it from reusing the interactive login). Env-first, then KeyVault — the
        // same precedence as KeyResolver. OAuth/Teams users provide a token via
        // `claude setup-token` → CLAUDE_CODE_OAUTH_TOKEN.
        resolveAuthEnv: () => {
          const env: Record<string, string> = {};
          const oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
          if (oauth) env.CLAUDE_CODE_OAUTH_TOKEN = oauth;
          const apiKey = resolver.get('anthropic');
          if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
          return env;
        },
      }),
    openAIBuilder: (model) =>
      new OpenAIProvider({
        apiKey: resolver.get('openai') ?? '',
        model: model as 'gpt-5' | 'gpt-5-mini' | 'gpt-4.1' | 'o3',
      }),
    listOpenAICompatEndpoints,
    openAICompatBuilder: (baseUrl, model, headers) =>
      new OpenAIProvider({ apiKey: '', model, baseUrl: `${baseUrl}/chat/completions`, headers }),
    defaultOverride:
      process.env.AETHER_DEFAULT_PROVIDER ||
      (cfg.fakeProvider ? 'fake:default' : 'anthropic:claude-opus-4-8'),
  });

  await providers.refresh();

  // Boot-time: start only the terminal built-in MCP globally (best-effort).
  // filesystem and git are NOT pre-started — they spawn lazily per-root via
  // ensureRootedBuiltins() in each dispatch, so they always inherit the correct root.
  const builtins = builtinStore.read();
  for (const b of builtins) {
    if (b.enabled && b.transport === 'terminal') {
      await mcpRegistry.startBuiltin(b.transport).catch((err) => {
        console.warn(
          `[builtin-mcp] failed to start ${b.transport}: ${err instanceof Error ? err.message : err}`,
        );
      });
    }
  }

  const authStatusService = new AuthStatusService({
    detectAnthropicAuth,
    getAnthropicKey: () => resolver.get('anthropic'),
    getOpenAIKey: () => resolver.get('openai'),
    getGeminiKey: () => resolver.get('gemini'),
    listOllamaEndpoints,
    listOpenAICompatEndpoints,
  });

  // Detect whether the claude CLI is present (for the info row label).
  // We re-use the existing detector — if it returns anything other than 'none', the CLI is reachable.
  const anthropicAuth = await detectAnthropicAuth();
  const anthropicCliPresent = anthropicAuth !== 'none';
  console.log(`[providers] anthropic: ${anthropicAuth}`);

  const buildInfoRowsCtx = { anthropicCliPresent, ollamaHost };

  const keyVaultHooks = {
    setAnthropicEnv: (key: string | null) => {
      if (key) process.env.ANTHROPIC_API_KEY = key;
      else delete process.env.ANTHROPIC_API_KEY;
    },
  };

  const skillStateStore = new SkillStateStore(db);
  const skillsService = new SkillsService(skillStateStore, cfg.libraryDir);

  const dispatcher = new DispatchService({
    providers,
    historyStore,
    contextStore,
    subAgentsStore,
    mcpRegistry,
    breakpointService,
    previewService,
    skillsService,
    maxToolCallsPerDispatch: cfg.maxToolCallsPerDispatch,
    projectRootFor: (workspaceId) => {
      if (workspaceId) {
        const ws = workspacesStore.get(workspaceId);
        if (ws) return ws.rootPath;
      }
      return builtinStore.read().find((r) => r.transport === 'filesystem')?.fsRoot ?? null;
    },
    listWorkspaceRoots: () => workspacesStore.list().map((w) => w.rootPath),
  });

  const swarmStore = new SwarmStore(db);
  const swarmApprovals = new SwarmApprovalRegistry();
  const swarmOrchestratorDeps = {
    store: swarmStore,
    subAgentsStore,
    dispatcher,
    createSession: async () => (await historyStore.createEmpty()).id,
    approvals: swarmApprovals,
    providers: {
      isAvailable: (name: string) => providers.get(name) !== null,
      defaultName: () => providers.defaultName(),
    },
  };

  const tddRunnerDeps = {
    runCommand: createRunCommand(executeCommand),
    subAgentsStore,
    dispatcher,
    createSession: async () => (await historyStore.createEmpty()).id,
  };

  const scheduleStore = new ScheduleStore(db);
  const scheduleRunner = new ScheduleRunner({
    store: scheduleStore,
    historyStore, contextStore, providers, subAgentsStore,
    mcpRegistry, breakpointService,
    swarmStore, swarmApprovals,
  });
  const scheduler = new SchedulerService({ store: scheduleStore, runner: scheduleRunner, now: () => Date.now() });

  const app = createApp({
    contextStore,
    historyStore,
    dispatcher,
    profilesStore,
    subAgentsStore,
    mcpRegistry,
    builtinStore,
    providers,
    searchService,
    gitService,
    authStatusService,
    keyVault,
    keyVaultHooks,
    buildInfoRowsCtx,
    ollamaEndpointStore,
    policyStore,
    previewService,
    workspacesStore,
    filesystemBrowser,
    swarmStore,
    swarmApprovals,
    swarmOrchestratorDeps,
    tddRunnerDeps,
    scheduleStore,
    scheduleRunner,
    skillsService,
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const isDaemon = process.env.AETHER_DAEMON === '1';
  const host = isDaemon ? '127.0.0.1' : '0.0.0.0';

  app.listen(cfg.port, host, () => {
    console.log(`Aether server running on http://localhost:${cfg.port}`);
    if (isDaemon) {
      writeDaemonFile(cfg.dataDir, {
        pid: process.pid,
        host: '127.0.0.1',
        port: cfg.port,
        startedAt: new Date().toISOString(),
      });
    }
  });

  if (process.env.AETHER_SCHEDULER !== '0') scheduler.start();
  process.on('SIGTERM', () => scheduler.stop());
  process.on('SIGINT', () => scheduler.stop());

  if (isDaemon) {
    const cleanup = () => {
      clearDaemonFile(cfg.dataDir);
      process.exit(0);
    };
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('exit', () => clearDaemonFile(cfg.dataDir));
  }
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
