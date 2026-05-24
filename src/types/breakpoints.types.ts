export type ToolCategory = 'safe' | 'dangerous' | 'external';
export type CategoryMode = 'auto' | 'gate';

export interface BreakpointPolicy {
  safe: CategoryMode;
  dangerous: CategoryMode;
  external: CategoryMode;
}

export interface ClassifiedTool {
  qualifiedName: string;
  category: ToolCategory;
  source: 'heuristic' | 'override';
}

export type PreviewResult =
  | { kind: 'diff'; oldText: string; newText: string; path: string }
  | { kind: 'plain' };
