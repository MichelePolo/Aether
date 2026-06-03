import type {
  AuthStatusReport,
  ProviderTransport,
  TransportStatus,
  OllamaEndpointStatus,
} from './auth-status.types';
import { TRANSPORT_ORDER } from './auth-status.types';
import { ANTHROPIC_MODELS_URL, ANTHROPIC_VERSION } from './discovery';

type AnthropicAuth = 'oauth' | 'apikey' | 'none';

export interface AuthStatusServiceDeps {
  detectAnthropicAuth: () => Promise<AnthropicAuth>;
  getAnthropicKey: () => string | undefined;
  getOpenAIKey: () => string | undefined;
  getGeminiKey: () => string | undefined;
  listOllamaEndpoints: () => Array<{ id: string; label: string; baseUrl: string; token?: string }>;
  /** Override for tests; defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Per-probe timeout in ms; default 5000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class AuthStatusService {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly deps: AuthStatusServiceDeps) {
    this.fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async probe(transports?: ProviderTransport[]): Promise<AuthStatusReport> {
    const wanted = transports ?? TRANSPORT_ORDER;
    const keyed = wanted.filter((t): t is Exclude<ProviderTransport, 'ollama'> => t !== 'ollama');
    const statuses = await Promise.all(keyed.map((t) => this.probeOne(t)));
    const ollama = wanted.includes('ollama') ? await this.probeOllamaEndpoints() : [];
    return { statuses, ollama, checkedAt: Date.now() };
  }

  private async probeOne(
    transport: Exclude<ProviderTransport, 'ollama'>,
  ): Promise<TransportStatus> {
    try {
      if (transport === 'anthropic') return await this.probeAnthropic();
      if (transport === 'openai') return await this.probeOpenAI();
      return await this.probeGemini();
    } catch (err) {
      return { transport, state: 'error', reason: shortReason(err), detail: longDetail(err) };
    }
  }

  private async probeAnthropic(): Promise<TransportStatus> {
    const result = await this.deps.detectAnthropicAuth();
    if (result === 'oauth') return { transport: 'anthropic', state: 'ok', reason: 'oauth' };
    if (result === 'apikey') {
      const apiKey = this.deps.getAnthropicKey();
      if (!apiKey) return { transport: 'anthropic', state: 'unconfigured', reason: 'no api key' };
      const res = await this.fetchWithTimeout(`${ANTHROPIC_MODELS_URL}?limit=1`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      });
      if (res.ok) return { transport: 'anthropic', state: 'ok', reason: 'api key set' };
      return {
        transport: 'anthropic',
        state: 'error',
        reason: String(res.status),
        detail: res.statusText || `HTTP ${res.status}`,
      };
    }
    return { transport: 'anthropic', state: 'unconfigured', reason: 'no api key' };
  }

  private async probeOpenAI(): Promise<TransportStatus> {
    const apiKey = this.deps.getOpenAIKey();
    if (!apiKey) {
      return { transport: 'openai', state: 'unconfigured', reason: 'no api key' };
    }
    const res = await this.fetchWithTimeout('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { transport: 'openai', state: 'ok', reason: 'api key set' };
    return {
      transport: 'openai',
      state: 'error',
      reason: String(res.status),
      detail: res.statusText || `HTTP ${res.status}`,
    };
  }

  private async probeGemini(): Promise<TransportStatus> {
    const apiKey = this.deps.getGeminiKey();
    if (!apiKey) {
      return { transport: 'gemini', state: 'unconfigured', reason: 'no api key' };
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
      apiKey,
    )}`;
    const res = await this.fetchWithTimeout(url);
    if (res.ok) return { transport: 'gemini', state: 'ok', reason: 'api key set' };
    return {
      transport: 'gemini',
      state: 'error',
      reason: String(res.status),
      detail: res.statusText || `HTTP ${res.status}`,
    };
  }

  private async probeOllamaEndpoints(): Promise<OllamaEndpointStatus[]> {
    const eps = this.deps.listOllamaEndpoints();
    return Promise.all(eps.map((ep) => this.probeOneOllama(ep)));
  }

  private async probeOneOllama(ep: {
    id: string;
    label: string;
    baseUrl: string;
    token?: string;
  }): Promise<OllamaEndpointStatus> {
    const base = { id: ep.id, label: ep.label, fixed: ep.id === 'local' };
    try {
      const headers: Record<string, string> = {};
      if (ep.token) headers.Authorization = `Bearer ${ep.token}`;
      const url = `${ep.baseUrl.replace(/\/$/, '')}/api/tags`;
      const res = await this.fetchWithTimeout(url, { headers });
      if (!res.ok) {
        return { ...base, state: 'error', reason: String(res.status), detail: res.statusText || `HTTP ${res.status}` };
      }
      const body = (await res.json().catch(() => ({ models: [] }))) as { models?: Array<{ name: string }> };
      const count = body.models?.length ?? 0;
      return { ...base, state: 'ok', reason: `${count} model${count === 1 ? '' : 's'}` };
    } catch (err) {
      return { ...base, state: 'error', reason: shortReason(err), detail: longDetail(err) };
    }
  }

  private async fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const ac = new AbortController();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        ac.abort();
        const e: Error & { code?: string } = new Error('timeout');
        e.code = 'TIMEOUT';
        reject(e);
      }, this.timeoutMs);
    });

    const fetchPromise = this.fetchImpl(input, { ...(init ?? {}), signal: ac.signal }).catch(
      (err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') {
          const e: Error & { code?: string } = new Error('timeout');
          e.code = 'TIMEOUT';
          throw e;
        }
        throw err;
      },
    );

    const winner = Promise.race([fetchPromise, timeoutPromise]);
    // Silence the loser's rejection so a slow non-abort error after the timer
    // wins doesn't surface as an unhandledRejection.
    fetchPromise.catch(() => {});
    return winner;
  }
}

function shortReason(err: unknown): string {
  if (!err) return 'error';
  const code = (err as { code?: string })?.code;
  if (code === 'TIMEOUT') return 'timeout';
  if (code) return code;
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)/);
  return m?.[1] ?? 'error';
}

function longDetail(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
