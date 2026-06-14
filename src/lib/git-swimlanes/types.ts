export type FileStatusCode =
  | "A" | "M" | "D" | "T" | "U" | "B"
  | `R${number}` | `C${number}`;

export interface FileChange {
  code: FileStatusCode;
  path: string;
  old?: string;
}

export interface CommitNode {
  hash: string;
  parents: string[];      // parents[0] = first-parent
  author: string;
  date: string;
  subject: string;
  branches: string[];
  tags: string[];
  head: boolean;
  files: FileChange[];
}

export interface LaneModel {
  commits: CommitNode[];
  byHash: Record<string, CommitNode>;
  laneOf: Record<string, number>;
  branchOf: Record<string, string>;
  laneNames: string[];
  nLanes: number;
  rowOf: Record<string, number>;
  graphW: number;
}

export interface DiffRequest { hash: string; path: string; oldPath?: string; }
export interface DiffResult  { unified: string; }

export interface PullRequestRef {
  id: string;
  src: "Azure DevOps" | "GitHub" | "GitLab" | "Bitbucket" | "squash";
}

export interface SwimlanesOptions {
  newestFirst?: boolean;
  showLaneGuides?: boolean;
  detectPullRequests?: boolean;
  multiExpand?: boolean;
}

export type WorkingFileStatus =
  | 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange'
  | 'untracked' | 'conflicted';

export interface WorkingFile {
  path: string;
  oldPath?: string;
  status: WorkingFileStatus;
}

export interface WorkingChanges {
  staged: WorkingFile[];
  unstaged: WorkingFile[];
  untracked: WorkingFile[];
  conflicted: WorkingFile[];
  branch?: string;
  ahead?: number;
  behind?: number;
}
