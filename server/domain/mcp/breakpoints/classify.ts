import {
  DANGEROUS_NAME_PATTERNS,
  type ClassifiedTool,
  type ToolCategory,
} from './breakpoints.types';

export interface ClassifyInput {
  qualifiedName: string;
  args: Record<string, unknown>;
  override?: { category?: ToolCategory };
}

export function classifyTool(input: ClassifyInput): ClassifiedTool {
  if (input.override?.category) {
    return {
      qualifiedName: input.qualifiedName,
      category: input.override.category,
      source: 'override',
    };
  }

  for (const pattern of DANGEROUS_NAME_PATTERNS) {
    if (pattern.test(input.qualifiedName)) {
      return {
        qualifiedName: input.qualifiedName,
        category: 'dangerous',
        source: 'heuristic',
      };
    }
  }

  return {
    qualifiedName: input.qualifiedName,
    category: 'safe',
    source: 'heuristic',
  };
}
