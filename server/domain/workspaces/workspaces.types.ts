export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  addedAt: number;
}

export interface BrowseEntry {
  name: string;
  isDir: boolean;
}
