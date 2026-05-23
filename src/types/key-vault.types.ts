export type VaultTransport = 'anthropic' | 'openai' | 'gemini';
export type InfoTransport = 'anthropic-oauth' | 'ollama';

export const VAULT_TRANSPORTS: readonly VaultTransport[] = ['anthropic', 'openai', 'gemini'];

export interface MaskedKeyRow {
  transport: VaultTransport;
  hasKey: boolean;
  masked: string | null;
  updatedAt: number | null;
}

export interface ReadonlyInfoRow {
  transport: InfoTransport;
  label: string;
  status: string;
}

export interface KeyVaultListResponse {
  vault: MaskedKeyRow[];
  info: ReadonlyInfoRow[];
}

export interface SaveKeyResponse {
  row: MaskedKeyRow;
  status: { transport: string; state: 'ok' | 'unconfigured' | 'error'; reason: string; detail?: string } | null;
}
