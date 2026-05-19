export type ReasoningStepType =
  | 'context_fetch'
  | 'mcp_query'
  | 'dispatch'
  | 'thinking'
  | 'validation'
  | 'logic'
  | 'resolve_subagent';

export interface ReasoningStep {
  id: string;
  type: ReasoningStepType;
  title: string;
  content: string;
  tokens?: number;
  durationMs?: number;
  subAgent?: string;
  timestamp: number;
}
