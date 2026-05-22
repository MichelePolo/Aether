import type {
  AuthStatusReport,
  ProviderTransport,
  TransportStatus,
} from './auth-status.types';
import { TRANSPORT_ORDER } from './auth-status.types';

type AnthropicAuth = 'oauth' | 'apikey' | 'none';

export interface AuthStatusServiceDeps {
  detectAnthropicAuth: () => Promise<AnthropicAuth>;
  openAIApiKey: string | undefined;
  geminiApiKey: string | undefined;
  ollamaHost: string;
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
    const all = await Promise.all(wanted.map((t) => this.probeOne(t)));
    return { statuses: all, checkedAt: Date.now() };
  }

  private async probeOne(transport: ProviderTransport): Promise<TransportStatus> {
    try {
      if (transport === 'anthropic') return await this.probeAnthropic();
      if (transport === 'openai') return await this.probeOpenAI();
      if (transport === 'gemini') return await this.probeGemini();
      return await this.probeOllama();
    } catch (err) {
      return { transport, state: 'error', reason: shortReason(err), detail: longDetail(err) };
    }
  }

  private async probeAnthropic(): Promise<TransportStatus> {
    const result = await this.deps.detectAnthropicAuth();
    if (result === 'oauth') return { transport: 'anthropic', state: 'ok', reason: 'oauth' };
    if (result === 'apikey') return { transport: 'anthropic', state: 'ok', reason: 'api key set' };
    return { transport: 'anthropic', state: 'unconfigured', reason: 'no api key' };
  }

  private async probeOpenAI(): Promise<TransportStatus> {
    if (!this.deps.openAIApiKey) {
      return { transport: 'openai', state: 'unconfigured', reason: 'no api key' };
    }
    const res = await this.fetchWithTimeout('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${this.deps.openAIApiKey}` },
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
    if (!this.deps.geminiApiKey) {
      return { transport: 'gemini', state: 'unconfigured', reason: 'no api key' };
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
      this.deps.geminiApiKey,
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

  private async probeOllama(): Promise<TransportStatus> {
    const url = `${this.deps.ollamaHost.replace(/\/$/, '')}/api/tags`;
    const res = await this.fetchWithTimeout(url);
    if (!res.ok) {
      return {
        transport: 'ollama',
        state: 'error',
        reason: String(res.status),
        detail: res.statusText || `HTTP ${res.status}`,
      };
    }
    const body = (await res.json().catch(() => ({ models: [] }))) as {
      models?: Array<{ name: string }>;
    };
    const count = body.models?.length ?? 0;
    return { transport: 'ollama', state: 'ok', reason: `${count} models` };
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

    return Promise.race([fetchPromise, timeoutPromise]);
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
