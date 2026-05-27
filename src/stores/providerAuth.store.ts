import { create } from 'zustand';
import { providersApi } from '@/src/lib/api/providers.api';
import type {
  AuthStatusReport, ProviderTransport, TransportStatus,
} from '@/src/types/provider-auth.types';
import type { OllamaEndpointStatus } from '@/src/types/ollama-endpoints.types';

interface ProviderAuthState {
  statuses: TransportStatus[];
  ollama: OllamaEndpointStatus[];
  checkedAt: number | null;
  loading: boolean;
  error: string | null;
  init(): Promise<void>;
  refresh(transport?: ProviderTransport): Promise<void>;
  _reset(): void;
}

const initial = {
  statuses: [] as TransportStatus[],
  ollama: [] as OllamaEndpointStatus[],
  checkedAt: null as number | null,
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

// Module-level dedupe registry: key -> in-flight promise.
const inflight = new Map<string, Promise<AuthStatusReport>>();

export const useProviderAuthStore = create<ProviderAuthState>((set) => ({
  ...initial,
  _reset: () => { inflight.clear(); set(initial); },
  init: async () => {
    set({ loading: true, error: null });
    try {
      const report = await providersApi.fetchAuthStatus();
      set({ statuses: report.statuses, ollama: report.ollama, checkedAt: report.checkedAt, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },
  refresh: async (transport) => {
    const key = transport ?? 'all';
    const existing = inflight.get(key);
    if (existing) { await existing.catch(() => {}); return; }
    set({ loading: true, error: null });
    const promise = providersApi.refreshAuthStatus(transport);
    inflight.set(key, promise);
    try {
      const report = await promise;
      set((s) => ({
        statuses: report.statuses.length ? report.statuses : s.statuses,
        ollama: report.ollama.length ? report.ollama : s.ollama,
        checkedAt: report.checkedAt,
        loading: false,
        error: null,
      }));
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    } finally {
      inflight.delete(key);
    }
  },
}));
