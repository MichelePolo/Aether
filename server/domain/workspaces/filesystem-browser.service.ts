import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BrowseEntry } from './workspaces.types';

export class FilesystemBrowserService {
  async browse(path: string): Promise<BrowseEntry[]> {
    const dirents = await readdir(path, { withFileTypes: true });
    const entries = dirents
      .filter((d) => d.isDirectory())
      // Resolve each child to an absolute path so the client descends by
      // absolute path, never a name relative to the server's process cwd.
      .map((d) => ({ name: d.name, path: resolve(path, d.name), isDir: true }));
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
  }
}
