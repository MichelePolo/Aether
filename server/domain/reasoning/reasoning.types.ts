export type ReasoningStepType =
  | 'context_fetch'
  | 'mcp_query'
  | 'dispatch'
  | 'thinking'
  | 'validation'
  | 'logic'
  | 'resolve_subagent'
  | 'tool_call'
  | 'assembled_prompt';

export interface ToolCallTrace {
  id: string;
  qualifiedName: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs: number;
  progressNote?: string;
}

export interface ReasoningStep {
  id: string;
  type: ReasoningStepType;
  title: string;
  content: string;
  tokens?: number;
  durationMs?: number;
  subAgent?: string;
  toolCall?: ToolCallTrace;
  timestamp: number;
}
