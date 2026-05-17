import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import PQueue from 'p-queue';
import type { ZodSchema } from 'zod';

export class JsonStore<T> {
  private queue = new PQueue({ concurrency: 1 });

  constructor(
    private readonly filePath: string,
    private readonly schema: ZodSchema<T>,
    private readonly defaultValue: T,
  ) {}

  async read(): Promise<T> {
    return this.queue.add(async () => this.readInternal()) as Promise<T>;
  }

  async write(value: T): Promise<void> {
    await this.queue.add(async () => this.writeInternal(value));
  }

  async update(fn: (current: T) => T): Promise<T> {
    return this.queue.add(async () => {
      const current = await this.readInternal();
      const next = fn(current);
      await this.writeInternal(next);
      return next;
    }) as Promise<T>;
  }

  private async readInternal(): Promise<T> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const result = this.schema.safeParse(parsed);
      return result.success ? result.data : this.defaultValue;
    } catch {
      // ENOENT, JSON invalido, errore I/O → defaults
      return this.defaultValue;
    }
  }

  private async writeInternal(value: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const serialized = JSON.stringify(value, null, 2);
    await writeFile(tmp, serialized, 'utf-8');
    await rename(tmp, this.filePath);
  }
}
