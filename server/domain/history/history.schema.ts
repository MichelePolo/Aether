import { z } from 'zod';

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'model']),
  text: z.string(),
  timestamp: z.number(),
  model: z.string().optional(),
  interrupted: z.boolean().optional(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
});

export const SessionsFileSchema = z.record(z.string(), z.array(MessageSchema));
