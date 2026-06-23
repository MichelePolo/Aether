import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '@/server/db/database';
import { encrypt, decrypt } from '@/server/lib/key-crypto';
import { mask } from './key-vault.types';
import type {
  OllamaEndpointRecord,
  ResolvedOllamaEndpoint,
  CreateOllamaEndpointInput,
  UpdateOllamaEndpointInput,
} from './ollama-endpoints.types';

interface Row {
  id: string;
  label: string;
  base_url: string;
  token_ciphertext: Buffer | null;
  token_iv: Buffer | null;
  token_auth_tag: Buffer | null;
  headers_ciphertext: Buffer | null;
  headers_iv: Buffer | null;
  headers_auth_tag: Buffer | null;
  created_at: number;
  updated_at: number;
}

export class OllamaEndpointStore {
  constructor(private readonly db: DatabaseHandle) {}

  list(): OllamaEndpointRecord[] {
    return this.db
      .prepare<[], Row>(`SELECT * FROM ollama_endpoints ORDER BY created_at ASC`)
      .all()
      .map((r) => this.toRecord(r));
  }

  listResolved(): ResolvedOllamaEndpoint[] {
    return this.db
      .prepare<[], Row>(`SELECT * FROM ollama_endpoints ORDER BY created_at ASC`)
      .all()
      .map((r) => ({
        id: r.id,
        label: r.label,
        baseUrl: r.base_url,
        token: this.decryptToken(r) ?? undefined,
        headers: this.decryptHeaders(r) ?? {},
      }));
  }

  get(id: string): OllamaEndpointRecord | null {
    const r = this.db
      .prepare<[string], Row>(`SELECT * FROM ollama_endpoints WHERE id = ?`)
      .get(id);
    return r ? this.toRecord(r) : null;
  }

  create(input: CreateOllamaEndpointInput): OllamaEndpointRecord {
    const id = randomUUID();
    const now = Date.now();
    const tok = input.token ? encrypt(input.token) : null;
    const hdrs = this.encryptHeaders(input.headers ?? {});
    this.db
      .prepare(
        `INSERT INTO ollama_endpoints
           (id, label, base_url, token_ciphertext, token_iv, token_auth_tag,
            headers_ciphertext, headers_iv, headers_auth_tag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.label,
        input.baseUrl,
        tok?.ciphertext ?? null,
        tok?.iv ?? null,
        tok?.authTag ?? null,
        hdrs?.ciphertext ?? null,
        hdrs?.iv ?? null,
        hdrs?.authTag ?? null,
        now,
        now,
      );
    return this.get(id)!;
  }

  update(id: string, patch: UpdateOllamaEndpointInput): OllamaEndpointRecord {
    const existing = this.db
      .prepare<[string], Row>(`SELECT * FROM ollama_endpoints WHERE id = ?`)
      .get(id);
    if (!existing) throw new Error(`[ollama-endpoints] not found: ${id}`);

    const label = patch.label ?? existing.label;
    const baseUrl = patch.baseUrl ?? existing.base_url;

    let cipher = existing.token_ciphertext;
    let iv = existing.token_iv;
    let tag = existing.token_auth_tag;
    if (patch.token !== undefined) {
      if (patch.token === null || patch.token === '') {
        cipher = null;
        iv = null;
        tag = null;
      } else {
        const blob = encrypt(patch.token);
        cipher = blob.ciphertext;
        iv = blob.iv;
        tag = blob.authTag;
      }
    }

    let hCipher = existing.headers_ciphertext;
    let hIv = existing.headers_iv;
    let hTag = existing.headers_auth_tag;
    if (patch.headers !== undefined) {
      const blob = this.encryptHeaders(patch.headers);
      hCipher = blob?.ciphertext ?? null;
      hIv = blob?.iv ?? null;
      hTag = blob?.authTag ?? null;
    }

    this.db
      .prepare(
        `UPDATE ollama_endpoints
           SET label = ?, base_url = ?,
               token_ciphertext = ?, token_iv = ?, token_auth_tag = ?,
               headers_ciphertext = ?, headers_iv = ?, headers_auth_tag = ?,
               updated_at = ?
         WHERE id = ?`,
      )
      .run(label, baseUrl, cipher, iv, tag, hCipher, hIv, hTag, Date.now(), id);

    return this.get(id)!;
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM ollama_endpoints WHERE id = ?`).run(id);
  }

  private decryptToken(r: Row): string | null {
    if (!r.token_ciphertext || !r.token_iv || !r.token_auth_tag) return null;
    try {
      return decrypt({ ciphertext: r.token_ciphertext, iv: r.token_iv, authTag: r.token_auth_tag });
    } catch {
      console.warn(`[ollama-endpoints] decrypt token failed for ${r.id}: auth-tag mismatch`);
      return null;
    }
  }

  private encryptHeaders(headers: Record<string, string>) {
    if (Object.keys(headers).length === 0) return null;
    return encrypt(JSON.stringify(headers));
  }

  private decryptHeaders(r: Row): Record<string, string> | null {
    if (!r.headers_ciphertext || !r.headers_iv || !r.headers_auth_tag) return null;
    try {
      const plain = decrypt({
        ciphertext: r.headers_ciphertext,
        iv: r.headers_iv,
        authTag: r.headers_auth_tag,
      });
      return JSON.parse(plain) as Record<string, string>;
    } catch {
      console.warn(`[ollama-endpoints] decrypt headers failed for ${r.id}: auth-tag mismatch`);
      return null;
    }
  }

  private toRecord(r: Row): OllamaEndpointRecord {
    const hasCipher = r.token_ciphertext !== null;
    const token = hasCipher ? this.decryptToken(r) : null;
    const headers = this.decryptHeaders(r);
    return {
      id: r.id,
      label: r.label,
      baseUrl: r.base_url,
      hasToken: token !== null,
      tokenMasked: token !== null ? mask(token) : null,
      fixed: false,
      headerKeys: headers ? Object.keys(headers) : [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
