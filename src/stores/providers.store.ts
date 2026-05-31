import { create } from 'zustand';
import { providersApi } from '@/src/lib/api/providers.api';
import type { ProviderDescriptor, ProviderCapabilities, RegistryIssue } from '@/src/types/provider.types';

const STORAGE_KEY = 'aether.defaultProvider';

interface ProvidersState {
  list: ProviderDescriptor[];
  issues: RegistryIssue[];
  defaultProvider: string | null;
  hydrated: boolean;
  error: string | null;

  init(): Promise<void>;
  refresh(): Promise<void>;
  setDefault(name: string): void;
  capabilitiesOf(name: string | null): ProviderCapabilities | null;
  _reset(): void;
}

const initial = {
  list: [] as ProviderDescriptor[],
  issues: [] as RegistryIssue[],
  defaultProvider: null as string | null,
  hydrated: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

function readStoredDefault(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredDefault(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // ignore
  }
}

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  ...initial,
  _reset: () => set(initial),

  init: async () => {
    try {
      const [listRes, serverDefault] = await Promise.all([
        providersApi.list(),
        providersApi.defaultName(),
      ]);
      const list = listRes.providers;
      const issues = listRes.issues ?? [];
      const stored = readStoredDefault();
      const storedIsAvailable = stored && list.some((p) => p.name === stored);
      const defaultProvider = storedIsAvailable
        ? stored
        : serverDefault && list.some((p) => p.name === serverDefault)
          ? serverDefault
          : list[0]?.name ?? null;
      set({ list, issues, defaultProvider, hydrated: true, error: null });
    } catch (e) {
      set({ hydrated: true, error: errMsg(e) });
    }
  },

  refresh: async () => {
    try {
      const res = await providersApi.refresh();
      set({ list: res.providers, issues: res.issues ?? [], error: null });
      const current = get().defaultProvider;
      if (current && !res.providers.some((p) => p.name === current)) {
        const serverDefault = await providersApi.defaultName();
        set({ defaultProvider: serverDefault });
      }
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  setDefault: (name) => {
    writeStoredDefault(name);
    set({ defaultProvider: name });
  },

  capabilitiesOf: (name) => {
    if (!name) return null;
    return get().list.find((p) => p.name === name)?.capabilities ?? null;
  },
}));
