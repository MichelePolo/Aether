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
  | { kind: 'gitDiff'; unified: string; title: string }
  | { kind: 'plain' };

export const DANGEROUS_NAME_PATTERNS: RegExp[] = [
  /^[^.]+\.(write|edit|delete|move|create|remove|rename|drop|truncate)_/i,
  /^[^.]+\.execute_command$/i,
  /^[^.]+\.git_(rebase|push|reset|add|commit|checkout|switch|restore|pull|merge)/i,
];

export const DANGEROUS_SHELL_PATTERNS: RegExp[] = [
  /git\s+push\s+(-f|--force)/,
  /npm\s+publish/,
  /yarn\s+publish/,
  /pnpm\s+publish/,
  /git\s+reset\s+--hard/,
  /git\s+rebase/,
  />\s*\/dev\/sd[a-z]/,
];
