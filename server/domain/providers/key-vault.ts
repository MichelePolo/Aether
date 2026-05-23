import type { DatabaseHandle } from '@/server/db/database';
import { encrypt, decrypt } from '@/server/lib/key-crypto';
import type { EncryptedBlob } from '@/server/lib/key-crypto';
import {
  VAULT_TRANSPORTS,
  mask,
  type VaultTransport,
  type InfoTransport,
  type MaskedKeyRow,
  type ReadonlyInfoRow,
} from './key-vault.types';

interface ProviderKeyRow {
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  updated_at: number;
}

export class KeyVaultService {
  constructor(private readonly db: DatabaseHandle) {}

  setKey(transport: VaultTransport, plaintext: string): void {
    if (!plaintext) throw new Error('[key-vault] plaintext must not be empty');
    const blob: EncryptedBlob = encrypt(plaintext);
    this.db
      .prepare(
        `INSERT INTO provider_keys (transport, ciphertext, iv, auth_tag, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(transport) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           iv = excluded.iv,
           auth_tag = excluded.auth_tag,
           updated_at = excluded.updated_at`,
      )
      .run(
        transport,
        blob.ciphertext,
        blob.iv,
        blob.authTag,
        Date.now(),
      );
  }

  getKey(transport: VaultTransport): string | null {
    const row = this.db
      .prepare<[string], ProviderKeyRow>(
        `SELECT ciphertext, iv, auth_tag, updated_at FROM provider_keys WHERE transport = ?`,
      )
      .get(transport);

    if (!row) return null;

    try {
      return decrypt({
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
      });
    } catch (err) {
      console.warn(`[key-vault] decrypt failed for ${transport}: auth-tag mismatch`);
      return null;
    }
  }

  clearKey(transport: VaultTransport): void {
    this.db
      .prepare(`DELETE FROM provider_keys WHERE transport = ?`)
      .run(transport);
  }

  listMasked(): MaskedKeyRow[] {
    return VAULT_TRANSPORTS.map((transport): MaskedKeyRow => {
      const plaintext = this.getKey(transport);
      if (plaintext === null) {
        return { transport, hasKey: false, masked: null, updatedAt: null };
      }
      const row = this.db
        .prepare<[string], { updated_at: number }>(
          `SELECT updated_at FROM provider_keys WHERE transport = ?`,
        )
        .get(transport);
      return {
        transport,
        hasKey: true,
        masked: mask(plaintext),
        updatedAt: row?.updated_at ?? null,
      };
    });
  }

  buildInfoRows(opts: {
    anthropicCliPresent: boolean;
    ollamaHost: string;
  }): ReadonlyInfoRow[] {
    const anthropicOauthRow: ReadonlyInfoRow = {
      transport: 'anthropic-oauth' as InfoTransport,
      label: 'Anthropic OAuth (via claude CLI)',
      status: opts.anthropicCliPresent ? 'detected' : 'no CLI on PATH',
    };
    const ollamaRow: ReadonlyInfoRow = {
      transport: 'ollama' as InfoTransport,
      label: 'Ollama',
      status: `Host: ${opts.ollamaHost}`,
    };
    return [anthropicOauthRow, ollamaRow];
  }
}
