import { z } from 'zod';

export const TddRunInputSchema = z.object({
  command: z.string().min(1).max(2000),
  subAgentName: z.string().min(1).max(80),
  maxRetries: z.number().int().min(1).max(20).optional(),
  cwd: z.string().max(4000).optional(),
});
