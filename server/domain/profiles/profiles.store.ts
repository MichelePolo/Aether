import { randomUUID } from 'node:crypto';
import { JsonStore } from '@/server/lib/json-store';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import { ProfilesFileSchema } from './profiles.schema';
import type { AetherContext } from '@/server/domain/context/context.types';
import type { ProfileMeta, ProfileRecord, ProfilesFile } from './profiles.types';

const NAME_MAX = 100;

function findUniqueName(file: ProfilesFile, desired: string): string {
  const existing = new Set(Object.values(file).map((r) => r.name));
  if (!existing.has(desired)) return desired;
  let n = 1;
  while (existing.has(`${desired} (${n})`)) n++;
  return `${desired} (${n})`;
}

function validateName(name: string): void {
  if (!name.trim()) throw new ValidationError('Name cannot be empty');
  if (name.length > NAME_MAX) throw new ValidationError(`Name too long (max ${NAME_MAX})`);
}

export class ProfilesStore {
  private json: JsonStore<ProfilesFile>;

  constructor(filePath: string) {
    this.json = new JsonStore<ProfilesFile>(filePath, ProfilesFileSchema, {});
  }

  async listProfiles(): Promise<ProfileMeta[]> {
    const file = await this.json.read();
    const metas: ProfileMeta[] = Object.entries(file).map(([id, rec]) => ({
      id,
      name: rec.name,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    }));
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  async read(id: string): Promise<ProfileRecord | null> {
    const file = await this.json.read();
    return file[id] ?? null;
  }

  async create(input: {
    name: string;
    context: AetherContext;
    thinkingEnabled: boolean;
  }): Promise<ProfileMeta> {
    validateName(input.name);
    const id = randomUUID();
    const now = Date.now();
    const updated = await this.json.update((cur) => {
      const uniqueName = findUniqueName(cur, input.name);
      const rec: ProfileRecord = {
        name: uniqueName,
        createdAt: now,
        updatedAt: now,
        context: input.context,
        thinkingEnabled: input.thinkingEnabled,
      };
      return { ...cur, [id]: rec };
    });
    const rec = updated[id];
    return { id, name: rec.name, createdAt: rec.createdAt, updatedAt: rec.updatedAt };
  }

  async update(
    id: string,
    patch: Partial<Omit<ProfileRecord, 'createdAt'>>,
  ): Promise<ProfileMeta> {
    if (patch.name !== undefined) validateName(patch.name);
    const updated = await this.json.update((cur) => {
      const r = cur[id];
      if (!r) throw new NotFoundError(`profile ${id}`);
      const next: ProfileRecord = {
        ...r,
        ...patch,
        createdAt: r.createdAt,
        updatedAt: Date.now(),
      };
      return { ...cur, [id]: next };
    });
    const rec = updated[id];
    return { id, name: rec.name, createdAt: rec.createdAt, updatedAt: rec.updatedAt };
  }

  rename(id: string, name: string): Promise<ProfileMeta> {
    return this.update(id, { name });
  }

  async delete(id: string): Promise<void> {
    await this.json.update((cur) => {
      if (!cur[id]) throw new NotFoundError(`profile ${id}`);
      const next: ProfilesFile = { ...cur };
      delete next[id];
      return next;
    });
  }
}
