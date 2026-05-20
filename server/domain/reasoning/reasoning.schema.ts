import { z } from 'zod';

export const ReasoningStepTypeSchema = z.enum([
  'context_fetch',
  'mcp_query',
  'dispatch',
  'thinking',
  'validation',
  'logic',
  'resolve_subagent',
  'tool_call',
]);

export const ToolCallTraceSchema = z.object({
  id: z.string(),
  qualifiedName: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number(),
  progressNote: z.string().optional(),
});

export const ReasoningStepSchema = z.object({
  id: z.string(),
  type: ReasoningStepTypeSchema,
  title: z.string(),
  content: z.string(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  subAgent: z.string().optional(),
  toolCall: ToolCallTraceSchema.optional(),
  timestamp: z.number(),
});
