import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '@/server/db/database';
import { encrypt, decrypt } from '@/server/lib/key-crypto';
import type {
  OpenAICompatEndpointRecord,
  ResolvedOpenAICompatEndpoint,
  CreateOpenAICompatEndpointInput,
  UpdateOpenAICompatEndpointInput,
} from './openai-endpoints.types';

interface Row {
  id: string;
  label: string;
  base_url: string;
  model: string | null;
  headers_ciphertext: Buffer | null;
  headers_iv: Buffer | null;
  headers_auth_tag: Buffer | null;
  created_at: number;
  updated_at: number;
}

export class OpenAICompatEndpointStore {
  constructor(private readonly db: DatabaseHandle) {}

  list(): OpenAICompatEndpointRecord[] {
    return this.db
      .prepare<[], Row>(`SELECT * FROM openai_compat_endpoints ORDER BY created_at ASC`)
      .all()
      .map((r) => this.toRecord(r));
  }

  listResolved(): ResolvedOpenAICompatEndpoint[] {
    return this.db
      .prepare<[], Row>(`SELECT * FROM openai_compat_endpoints ORDER BY created_at ASC`)
      .all()
      .map((r) => ({
        id: r.id,
        label: r.label,
        baseUrl: r.base_url,
        model: r.model,
        headers: this.decryptHeaders(r) ?? {},
      }));
  }

  get(id: string): OpenAICompatEndpointRecord | null {
    const r = this.db
      .prepare<[string], Row>(`SELECT * FROM openai_compat_endpoints WHERE id = ?`)
      .get(id);
    return r ? this.toRecord(r) : null;
  }

  create(input: CreateOpenAICompatEndpointInput): OpenAICompatEndpointRecord {
    const id = randomUUID();
    const now = Date.now();
    const hdrs = this.encryptHeaders(input.headers ?? {});
    this.db
      .prepare(
        `INSERT INTO openai_compat_endpoints
           (id, label, base_url, model, headers_ciphertext, headers_iv, headers_auth_tag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.label,
        input.baseUrl,
        input.model ?? null,
        hdrs?.ciphertext ?? null,
        hdrs?.iv ?? null,
        hdrs?.authTag ?? null,
        now,
        now,
      );
    return this.get(id)!;
  }

  update(id: string, patch: UpdateOpenAICompatEndpointInput): OpenAICompatEndpointRecord {
    const existing = this.db
      .prepare<[string], Row>(`SELECT * FROM openai_compat_endpoints WHERE id = ?`)
      .get(id);
    if (!existing) throw new Error(`[openai-endpoints] not found: ${id}`);

    const label = patch.label ?? existing.label;
    const baseUrl = patch.baseUrl ?? existing.base_url;
    const model = patch.model !== undefined ? (patch.model ?? null) : existing.model;

    let cipher = existing.headers_ciphertext;
    let iv = existing.headers_iv;
    let tag = existing.headers_auth_tag;
    if (patch.headers !== undefined) {
      const blob = this.encryptHeaders(patch.headers);
      cipher = blob?.ciphertext ?? null;
      iv = blob?.iv ?? null;
      tag = blob?.authTag ?? null;
    }

    this.db
      .prepare(
        `UPDATE openai_compat_endpoints
           SET label = ?, base_url = ?, model = ?, headers_ciphertext = ?, headers_iv = ?, headers_auth_tag = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(label, baseUrl, model, cipher, iv, tag, Date.now(), id);

    return this.get(id)!;
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM openai_compat_endpoints WHERE id = ?`).run(id);
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
      console.warn(`[openai-endpoints] decrypt failed for ${r.id}: auth-tag mismatch`);
      return null;
    }
  }

  private toRecord(r: Row): OpenAICompatEndpointRecord {
    const headers = this.decryptHeaders(r);
    return {
      id: r.id,
      label: r.label,
      baseUrl: r.base_url,
      model: r.model,
      headerKeys: headers ? Object.keys(headers) : [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
