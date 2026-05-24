export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  addedAt: number;
}

export interface BrowseEntry {
  name: string;
  /** Absolute path to the entry, used by the client to descend without relative resolution. */
  path: string;
  isDir: boolean;
}
