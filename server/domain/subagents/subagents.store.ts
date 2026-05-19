import { randomUUID } from 'node:crypto';
import { JsonStore } from '@/server/lib/json-store';
import { NotFoundError } from '@/server/lib/errors';
import { SubAgentsFileSchema } from './subagents.schema';
import type {
  SubAgentMeta,
  SubAgentRecord,
  SubAgentsFile,
} from './subagents.types';
import type { Tool } from '@/server/domain/context/context.types';

interface CreateInput {
  name: string;
  systemInstruction?: string;
  skills?: string[];
  tools?: Tool[];
}

function findUniqueName(file: SubAgentsFile, desired: string): string {
  const existing = new Set(Object.values(file).map((r) => r.name));
  if (!existing.has(desired)) return desired;
  let n = 2;
  while (existing.has(`${desired} (${n})`)) n++;
  return `${desired} (${n})`;
}

export class SubAgentsStore {
  private json: JsonStore<SubAgentsFile>;

  constructor(filePath: string) {
    this.json = new JsonStore<SubAgentsFile>(filePath, SubAgentsFileSchema, {});
  }

  async list(): Promise<SubAgentMeta[]> {
    const file = await this.json.read();
    const metas: SubAgentMeta[] = Object.entries(file).map(([id, rec]) => ({
      id,
      name: rec.name,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    }));
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  async read(id: string): Promise<SubAgentRecord | null> {
    const file = await this.json.read();
    return file[id] ?? null;
  }

  async create(input: CreateInput): Promise<SubAgentMeta> {
    const id = randomUUID();
    const now = Date.now();
    const updated = await this.json.update((cur) => {
      const uniqueName = findUniqueName(cur, input.name);
      const rec: SubAgentRecord = {
        name: uniqueName,
        systemInstruction: input.systemInstruction ?? '',
        skills: input.skills ?? [],
        tools: input.tools ?? [],
        createdAt: now,
        updatedAt: now,
      };
      return { ...cur, [id]: rec };
    });
    const rec = updated[id];
    return { id, name: rec.name, createdAt: rec.createdAt, updatedAt: rec.updatedAt };
  }

  async update(
    id: string,
    patch: Partial<Omit<SubAgentRecord, 'createdAt'>>,
  ): Promise<SubAgentMeta> {
    const updated = await this.json.update((cur) => {
      const r = cur[id];
      if (!r) throw new NotFoundError(`subagent ${id}`);
      const next: SubAgentRecord = {
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

  async delete(id: string): Promise<void> {
    await this.json.update((cur) => {
      if (!cur[id]) throw new NotFoundError(`subagent ${id}`);
      const next: SubAgentsFile = { ...cur };
      delete next[id];
      return next;
    });
  }
}
