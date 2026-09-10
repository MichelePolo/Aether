import {
  DANGEROUS_NAME_PATTERNS,
  DANGEROUS_SHELL_PATTERNS,
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

  const command = typeof input.args.cmd === 'string' ? input.args.cmd : typeof input.args.command === 'string' ? input.args.command : '';
  if (DANGEROUS_SHELL_PATTERNS.some(pattern => pattern.test(command))) {
    return { qualifiedName: input.qualifiedName, category: 'dangerous', source: 'heuristic' };
  }
  if (/\.(fetch_url|http_request|send_email|send_message|publish|upload)(_|$)/i.test(input.qualifiedName)) {
    return { qualifiedName: input.qualifiedName, category: 'external', source: 'heuristic' };
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
    category: /\.(read|get|list|search|stat|echo|git_(status|diff|log|show|fetch))(?:_|$)/i.test(input.qualifiedName) ? 'safe' : 'dangerous',
    source: 'heuristic',
  };
}
