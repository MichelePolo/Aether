import { z } from 'zod';

export const ReasoningStepTypeSchema = z.enum([
  'context_fetch',
  'mcp_query',
  'dispatch',
  'thinking',
  'validation',
  'logic',
]);

export const ReasoningStepSchema = z.object({
  id: z.string(),
  type: ReasoningStepTypeSchema,
  title: z.string(),
  content: z.string(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  subAgent: z.string().optional(),
  timestamp: z.number(),
});
