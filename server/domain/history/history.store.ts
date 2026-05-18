import { JsonStore } from '@/server/lib/json-store';
import { SessionsFileSchema } from './history.schema';
import type { Message, SessionsFile } from './history.types';

export const DEFAULT_SESSION_ID = 'default';

export class HistoryStore {
  private json: JsonStore<SessionsFile>;

  constructor(filePath: string) {
    this.json = new JsonStore<SessionsFile>(filePath, SessionsFileSchema, {});
  }

  async read(): Promise<Message[]> {
    const file = await this.json.read();
    return file[DEFAULT_SESSION_ID] ?? [];
  }

  async append(message: Message): Promise<void> {
    await this.json.update((cur) => {
      const list = cur[DEFAULT_SESSION_ID] ?? [];
      return { ...cur, [DEFAULT_SESSION_ID]: [...list, message] };
    });
  }

  async reset(): Promise<void> {
    await this.json.update((cur) => ({ ...cur, [DEFAULT_SESSION_ID]: [] }));
  }
}
