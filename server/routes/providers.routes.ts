import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AuthStatusService } from '@/server/domain/providers/auth-status';
import type {
  AuthStatusReport,
  ProviderTransport,
  TransportStatus,
} from '@/server/domain/providers/auth-status.types';
import type { KeyVaultService } from '@/server/domain/providers/key-vault';
import { VAULT_TRANSPORTS, type VaultTransport } from '@/server/domain/providers/key-vault.types';
import { ValidationError } from '@/server/lib/errors';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const VALID_TRANSPORTS: readonly ProviderTransport[] = ['anthropic', 'openai', 'gemini', 'ollama'];

export interface KeyVaultHooks {
  setAnthropicEnv: (key: string | null) => void;
}

export function createProvidersRoutes(
  registry: ProviderRegistry,
  authStatusService?: AuthStatusService,
  keyVault?: KeyVaultService,
  hooks?: KeyVaultHooks,
  buildInfoRowsCtx?: { anthropicCliPresent: boolean; ollamaHost: string },
): Router {
  const router = Router();

  // last-known report cached for merge on targeted refresh
  let lastReport: AuthStatusReport | null = null;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ providers: registry.list() });
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (_req, res) => {
      await registry.refresh();
      res.json({ providers: registry.list() });
    }),
  );

  router.get(
    '/default',
    asyncHandler(async (_req, res) => {
      const name = registry.defaultName();
      res.json({ name });
    }),
  );

  router.get(
    '/auth-status',
    asyncHandler(async (_req, res) => {
      if (!authStatusService) {
        res.status(503).json({ error: { code: 'NO_AUTH_STATUS', message: 'Auth status service not configured' } });
        return;
      }
      const report = await authStatusService.probe();
      lastReport = report;
      res.json(report);
    }),
  );

  router.post(
    '/auth-status/refresh',
    asyncHandler(async (req, res) => {
      if (!authStatusService) {
        res.status(503).json({ error: { code: 'NO_AUTH_STATUS', message: 'Auth status service not configured' } });
        return;
      }
      const qt = req.query.transport;
      const transport = typeof qt === 'string' ? qt : undefined;
      const filter =
        transport && VALID_TRANSPORTS.includes(transport as ProviderTransport)
          ? [transport as ProviderTransport]
          : undefined;
      const fresh = await authStatusService.probe(filter);
      const merged = mergeReport(lastReport, fresh);
      lastReport = merged;
      res.json(merged);
    }),
  );

  // ---------------------------------------------------------------------------
  // Key Vault routes
  // ---------------------------------------------------------------------------

  router.get(
    '/keys',
    asyncHandler(async (_req, res) => {
      if (!keyVault) {
        res.status(503).json({ error: { code: 'NO_KEY_VAULT', message: 'Key vault not configured' } });
        return;
      }
      const ctx = buildInfoRowsCtx ?? { anthropicCliPresent: false, ollamaHost: '' };
      res.json({ vault: keyVault.listMasked(), info: keyVault.buildInfoRows(ctx) });
    }),
  );

  router.get(
    '/keys/:transport',
    asyncHandler(async (req, res) => {
      if (!keyVault) {
        res.status(503).json({ error: { code: 'NO_KEY_VAULT', message: 'Key vault not configured' } });
        return;
      }
      const { transport } = req.params;
      if (!VAULT_TRANSPORTS.includes(transport as VaultTransport)) {
        throw new ValidationError(`Invalid transport: ${transport}`);
      }
      if (req.query.reveal !== '1') {
        throw new ValidationError('reveal=1 required');
      }
      const plaintext = keyVault.getKey(transport as VaultTransport);
      if (plaintext === null) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Key not set' } });
        return;
      }
      res.json({ plaintext });
    }),
  );

  router.put(
    '/keys/:transport',
    asyncHandler(async (req, res) => {
      if (!keyVault) {
        res.status(503).json({ error: { code: 'NO_KEY_VAULT', message: 'Key vault not configured' } });
        return;
      }
      const { transport } = req.params;
      if (!VAULT_TRANSPORTS.includes(transport as VaultTransport)) {
        throw new ValidationError(`Invalid transport: ${transport}`);
      }
      const key: unknown = req.body?.key;
      if (!key || typeof key !== 'string') {
        throw new ValidationError('Key required');
      }
      keyVault.setKey(transport as VaultTransport, key);
      if (transport === 'anthropic') {
        hooks?.setAnthropicEnv(key);
      }
      await registry.refresh();
      let status: TransportStatus | null = null;
      if (authStatusService) {
        const probe = await authStatusService.probe([transport as ProviderTransport]);
        status = probe.statuses[0] ?? null;
      }
      const row = keyVault.listMasked().find((r) => r.transport === transport) ?? null;
      res.json({ row, status });
    }),
  );

  router.delete(
    '/keys/:transport',
    asyncHandler(async (req, res) => {
      if (!keyVault) {
        res.status(503).json({ error: { code: 'NO_KEY_VAULT', message: 'Key vault not configured' } });
        return;
      }
      const { transport } = req.params;
      if (!VAULT_TRANSPORTS.includes(transport as VaultTransport)) {
        throw new ValidationError(`Invalid transport: ${transport}`);
      }
      keyVault.clearKey(transport as VaultTransport);
      if (transport === 'anthropic') {
        hooks?.setAnthropicEnv(null);
      }
      await registry.refresh();
      let status: TransportStatus | null = null;
      if (authStatusService) {
        const probe = await authStatusService.probe([transport as ProviderTransport]);
        status = probe.statuses[0] ?? null;
      }
      res.json({ status });
    }),
  );

  return router;
}

function mergeReport(prior: AuthStatusReport | null, fresh: AuthStatusReport): AuthStatusReport {
  if (!prior) return fresh;
  const byTransport = new Map<string, TransportStatus>();
  for (const s of prior.statuses) byTransport.set(s.transport, s);
  for (const s of fresh.statuses) byTransport.set(s.transport, s);
  return {
    checkedAt: fresh.checkedAt,
    statuses: VALID_TRANSPORTS
      .map((t) => byTransport.get(t))
      .filter((s): s is TransportStatus => Boolean(s)),
  };
}
