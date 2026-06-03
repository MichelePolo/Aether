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
import type { OllamaEndpointStore } from '@/server/domain/providers/ollama-endpoints.store';
import type { OllamaEndpointRecord } from '@/server/domain/providers/ollama-endpoints.types';

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
  ollamaEndpointStore?: OllamaEndpointStore,
): Router {
  const router = Router();

  const isHttpUrl = (v: unknown): v is string => {
    if (typeof v !== 'string' || v.trim() === '') return false;
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const localRow = (): OllamaEndpointRecord => ({
    id: 'local',
    label: 'local',
    baseUrl: buildInfoRowsCtx?.ollamaHost ?? 'http://localhost:11434',
    hasToken: false,
    tokenMasked: null,
    fixed: true,
    createdAt: null,
    updatedAt: null,
  });

  const ollamaStatusFor = async (id: string) => {
    if (!authStatusService) return null;
    const report = await authStatusService.probe(['ollama']);
    return report.ollama.find((e) => e.id === id) ?? null;
  };

  const isUniqueViolation = (err: unknown): boolean =>
    typeof (err as { code?: string })?.code === 'string' &&
    (err as { code: string }).code.startsWith('SQLITE_CONSTRAINT');

  // last-known report cached for merge on targeted refresh
  let lastReport: AuthStatusReport | null = null;

  // Riallinea il registry quando un probe rileva Anthropic autenticato ma la
  // lista modelli non lo contiene: succede se al boot detectAnthropicAuth() era
  // fallito (cold-start lento / proxy) e ha registrato 0 modelli, mentre il
  // probe successivo — più caldo — ora riesce. Senza questo, indicatore verde e
  // chat vuota restano disallineati finché l'utente non preme "Refresh".
  const reconcileAnthropic = async (report: AuthStatusReport): Promise<void> => {
    const anthropic = report.statuses.find((s) => s.transport === 'anthropic');
    if (anthropic?.state !== 'ok') return;
    if (registry.list().some((p) => p.transport === 'anthropic')) return;
    await registry.refresh();
  };

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
      await reconcileAnthropic(report);
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
      await reconcileAnthropic(merged);
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

  // ---------------------------------------------------------------------------
  // Ollama endpoint CRUD routes
  // ---------------------------------------------------------------------------

  router.get(
    '/ollama-endpoints',
    asyncHandler(async (_req, res) => {
      if (!ollamaEndpointStore) {
        res.status(503).json({ error: { code: 'NO_OLLAMA_STORE', message: 'Ollama endpoint store not configured' } });
        return;
      }
      res.json({ endpoints: [localRow(), ...ollamaEndpointStore.list()] });
    }),
  );

  router.post(
    '/ollama-endpoints',
    asyncHandler(async (req, res) => {
      if (!ollamaEndpointStore) {
        res.status(503).json({ error: { code: 'NO_OLLAMA_STORE', message: 'Ollama endpoint store not configured' } });
        return;
      }
      const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
      const baseUrl = req.body?.baseUrl;
      const token = typeof req.body?.token === 'string' && req.body.token.trim() !== '' ? req.body.token.trim() : undefined;
      if (!label) throw new ValidationError('label required');
      if (!isHttpUrl(baseUrl)) throw new ValidationError('baseUrl must be a valid http(s) URL');
      let endpoint: OllamaEndpointRecord;
      try {
        endpoint = ollamaEndpointStore.create({ label, baseUrl, token });
      } catch (err) {
        if (isUniqueViolation(err)) throw new ValidationError(`An endpoint named "${label}" already exists`);
        throw err;
      }
      await registry.refresh();
      const status = await ollamaStatusFor(endpoint.id);
      res.status(201).json({ endpoint, status });
    }),
  );

  router.put(
    '/ollama-endpoints/:id',
    asyncHandler(async (req, res) => {
      if (!ollamaEndpointStore) {
        res.status(503).json({ error: { code: 'NO_OLLAMA_STORE', message: 'Ollama endpoint store not configured' } });
        return;
      }
      const { id } = req.params;
      if (id === 'local') throw new ValidationError('The local endpoint is fixed and cannot be edited');
      if (!ollamaEndpointStore.get(id)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
        return;
      }
      const patch: { label?: string; baseUrl?: string; token?: string | null } = {};
      if (typeof req.body?.label === 'string') {
        const l = req.body.label.trim();
        if (!l) throw new ValidationError('label must not be empty');
        patch.label = l;
      }
      if (req.body?.baseUrl !== undefined) {
        if (!isHttpUrl(req.body.baseUrl)) throw new ValidationError('baseUrl must be a valid http(s) URL');
        patch.baseUrl = req.body.baseUrl;
      }
      if (req.body?.token !== undefined) {
        patch.token = req.body.token === null || req.body.token === '' ? null : String(req.body.token).trim();
      }
      let endpoint: OllamaEndpointRecord;
      try {
        endpoint = ollamaEndpointStore.update(id, patch);
      } catch (err) {
        if (isUniqueViolation(err)) throw new ValidationError(`An endpoint with that name already exists`);
        throw err;
      }
      await registry.refresh();
      const status = await ollamaStatusFor(id);
      res.json({ endpoint, status });
    }),
  );

  router.delete(
    '/ollama-endpoints/:id',
    asyncHandler(async (req, res) => {
      if (!ollamaEndpointStore) {
        res.status(503).json({ error: { code: 'NO_OLLAMA_STORE', message: 'Ollama endpoint store not configured' } });
        return;
      }
      const { id } = req.params;
      if (id === 'local') throw new ValidationError('The local endpoint is fixed and cannot be deleted');
      ollamaEndpointStore.remove(id);
      await registry.refresh();
      res.json({ ok: true });
    }),
  );

  return router;
}

const KEYED_TRANSPORTS: readonly ProviderTransport[] = ['anthropic', 'openai', 'gemini'];

function mergeReport(prior: AuthStatusReport | null, fresh: AuthStatusReport): AuthStatusReport {
  if (!prior) return fresh;
  const byTransport = new Map<string, TransportStatus>();
  for (const s of prior.statuses) byTransport.set(s.transport, s);
  for (const s of fresh.statuses) byTransport.set(s.transport, s);
  return {
    checkedAt: fresh.checkedAt,
    statuses: KEYED_TRANSPORTS
      .map((t) => byTransport.get(t))
      .filter((s): s is TransportStatus => Boolean(s)),
    // A targeted refresh that didn't probe Ollama returns ollama:[]; keep prior then.
    ollama: fresh.ollama.length > 0 ? fresh.ollama : prior.ollama,
  };
}
