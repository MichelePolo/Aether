import { create } from 'zustand';
import { providersApi } from '@/src/lib/api/providers.api';
import type { MaskedKeyRow, ReadonlyInfoRow, VaultTransport } from '@/src/types/key-vault.types';
import { useProvidersStore } from './providers.store';
import { useProviderAuthStore } from './providerAuth.store';

interface KeyVaultState {
  vault: MaskedKeyRow[];
  info: ReadonlyInfoRow[];
  loading: boolean;
  error: string | null;
  init(): Promise<void>;
  save(transport: VaultTransport, key: string): Promise<void>;
  clear(transport: VaultTransport): Promise<void>;
  reveal(transport: VaultTransport): Promise<string>;
  _reset(): void;
}

const initial = {
  vault: [] as MaskedKeyRow[],
  info: [] as ReadonlyInfoRow[],
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

// Module-level dedupe registry: "save:<t>" | "clear:<t>" -> in-flight promise.
const inflight = new Map<string, Promise<void>>();

export const useKeyVaultStore = create<KeyVaultState>((set, get) => ({
  ...initial,

  _reset: () => {
    inflight.clear();
    set(initial);
  },

  init: async () => {
    set({ loading: true, error: null });
    try {
      const { vault, info } = await providersApi.listKeys();
      set({ vault, info, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  save: async (transport, key) => {
    const dedupeKey = `save:${transport}`;
    const existing = inflight.get(dedupeKey);
    if (existing) {
      await existing.catch(() => {});
      return;
    }

    const promise = (async () => {
      set({ loading: true, error: null });
      try {
        const { row } = await providersApi.setKey(transport, key);
        set((state) => ({
          vault: state.vault.map((r) => (r.transport === transport ? row : r)),
          loading: false,
          error: null,
        }));
        // If transport was not yet in vault list, append it
        if (!get().vault.some((r) => r.transport === transport)) {
          set((state) => ({ vault: [...state.vault, row] }));
        }
        void useProvidersStore.getState().init();
        void useProviderAuthStore.getState().refresh(transport);
      } catch (e) {
        set({ loading: false, error: errMsg(e) });
      }
    })();

    inflight.set(dedupeKey, promise);
    try {
      await promise;
    } finally {
      inflight.delete(dedupeKey);
    }
  },

  clear: async (transport) => {
    const dedupeKey = `clear:${transport}`;
    const existing = inflight.get(dedupeKey);
    if (existing) {
      await existing.catch(() => {});
      return;
    }

    const promise = (async () => {
      set({ loading: true, error: null });
      try {
        await providersApi.clearKey(transport);
        set((state) => ({
          vault: state.vault.map((r) =>
            r.transport === transport
              ? { ...r, hasKey: false, masked: null, updatedAt: null }
              : r,
          ),
          loading: false,
          error: null,
        }));
        void useProvidersStore.getState().init();
        void useProviderAuthStore.getState().refresh(transport);
      } catch (e) {
        set({ loading: false, error: errMsg(e) });
      }
    })();

    inflight.set(dedupeKey, promise);
    try {
      await promise;
    } finally {
      inflight.delete(dedupeKey);
    }
  },

  reveal: async (transport) => {
    // Passthrough — never store the plaintext in state
    return providersApi.revealKey(transport);
  },
}));
