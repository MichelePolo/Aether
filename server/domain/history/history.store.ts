import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JsonStore } from '@/server/lib/json-store';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import { SessionsFileSchema } from './history.schema';
import { migrateLegacyDefault } from './history.migrate';
import { computeTitle } from './title';
import type { Message, SessionMeta, SessionRecord, SessionsFile } from './history.types';

const TITLE_MAX = 200;

export class HistoryStore {
  private json: JsonStore<SessionsFile>;
  private migrationApplied = false;

  constructor(private readonly filePath: string) {
    this.json = new JsonStore<SessionsFile>(filePath, SessionsFileSchema, {});
  }

  private async ensureMigrated(): Promise<SessionsFile> {
    if (this.migrationApplied) return this.json.read();

    // Bypass schema validation: JsonStore.read() returns the default {}
    // for files that fail zod parsing (e.g. legacy V1 shape with Message[]
    // values). To detect and migrate, we read the raw JSON ourselves.
    let raw: Record<string, unknown> = {};
    try {
      const text = await readFile(this.filePath, 'utf-8');
      raw = JSON.parse(text) as Record<string, unknown>;
    } catch {
      raw = {};
    }
    const migrated = migrateLegacyDefault(raw);

    // Persist only if the shape actually changed (idempotent on V2 data).
    if (JSON.stringify(migrated) !== JSON.stringify(raw)) {
      await this.json.write(migrated);
    }
    this.migrationApplied = true;
    return migrated;
  }

  async listSessions(): Promise<SessionMeta[]> {
    const file = await this.ensureMigrated();
    const metas: SessionMeta[] = Object.entries(file).map(([id, rec]) => ({
      id,
      title: rec.title,
      createdAt: rec.createdAt,
      updatedAt: rec.messages.at(-1)?.timestamp ?? rec.createdAt,
    }));
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  async read(sessionId: string): Promise<Message[] | null> {
    const file = await this.ensureMigrated();
    return file[sessionId]?.messages ?? null;
  }

  async createEmpty(): Promise<SessionMeta> {
    await this.ensureMigrated();
    const id = randomUUID();
    const now = Date.now();
    const rec: SessionRecord = { title: '', createdAt: now, messages: [] };
    await this.json.update((cur) => ({ ...cur, [id]: rec }));
    return { id, title: '', createdAt: now, updatedAt: now };
  }

  async append(sessionId: string, message: Message): Promise<void> {
    await this.ensureMigrated();
    await this.json.update((cur) => {
      const rec = cur[sessionId];
      if (!rec) throw new NotFoundError(`session ${sessionId}`);
      const isFirst = rec.messages.length === 0;
      const nextTitle =
        isFirst && message.role === 'user' && rec.title === ''
          ? computeTitle(message.text)
          : rec.title;
      return {
        ...cur,
        [sessionId]: {
          ...rec,
          title: nextTitle,
          messages: [...rec.messages, message],
        },
      };
    });
  }

  async rename(sessionId: string, title: string): Promise<SessionMeta> {
    if (!title.trim()) throw new ValidationError('Title cannot be empty');
    if (title.length > TITLE_MAX) throw new ValidationError(`Title too long (max ${TITLE_MAX})`);
    await this.ensureMigrated();
    let rec: SessionRecord | undefined;
    await this.json.update((cur) => {
      const r = cur[sessionId];
      if (!r) throw new NotFoundError(`session ${sessionId}`);
      rec = { ...r, title };
      return { ...cur, [sessionId]: rec };
    });
    const updatedRec = rec!;
    return {
      id: sessionId,
      title: updatedRec.title,
      createdAt: updatedRec.createdAt,
      updatedAt: updatedRec.messages.at(-1)?.timestamp ?? updatedRec.createdAt,
    };
  }

  async delete(sessionId: string): Promise<void> {
    await this.ensureMigrated();
    await this.json.update((cur) => {
      if (!cur[sessionId]) throw new NotFoundError(`session ${sessionId}`);
      const next: SessionsFile = { ...cur };
      delete next[sessionId];
      return next;
    });
  }
}
