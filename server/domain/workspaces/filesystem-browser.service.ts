import { readdir } from 'node:fs/promises';
import type { BrowseEntry } from './workspaces.types';

export class FilesystemBrowserService {
  async browse(path: string): Promise<BrowseEntry[]> {
    const dirents = await readdir(path, { withFileTypes: true });
    const entries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, isDir: true }));
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
  }
}
