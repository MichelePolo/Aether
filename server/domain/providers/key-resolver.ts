import type { KeyVaultService } from './key-vault';
import type { VaultTransport } from './key-vault.types';

export interface KeyResolverEnv {
  ANTHROPIC_API_KEY: string | undefined;
  OPENAI_API_KEY: string | undefined;
  GEMINI_API_KEY: string | undefined;
}

export interface KeyResolverDeps {
  vault: KeyVaultService;
  env: KeyResolverEnv;
}

const ENV_VAR: Record<VaultTransport, keyof KeyResolverEnv> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export class KeyResolver {
  constructor(private readonly deps: KeyResolverDeps) {}

  get(transport: VaultTransport): string | undefined {
    const envVar = this.deps.env[ENV_VAR[transport]];
    if (envVar) return envVar;
    const vaultKey = this.deps.vault.getKey(transport);
    return vaultKey ?? undefined;
  }
}
