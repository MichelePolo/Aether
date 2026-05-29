import { z } from 'zod';

export const SwarmStepSchema = z.object({
  subAgentName: z.string().min(1).max(80),
  promptTemplate: z.string().max(8000).default(''),
  pauseAfter: z.boolean().default(false),
});

export const SwarmCreateInputSchema = z.object({
  name: z.string().min(1).max(64),
  steps: z.array(SwarmStepSchema).max(20).default([]),
});

export const SwarmUpdateInputSchema = SwarmCreateInputSchema.partial();

export const SwarmRunInputSchema = z.object({
  input: z.string().min(1).max(20000),
});

export const SwarmDecisionSchema = z.object({
  approvalId: z.string().min(1),
  action: z.enum(['approve', 'reject']),
});
