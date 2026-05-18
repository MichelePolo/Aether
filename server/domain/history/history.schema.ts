import { z } from 'zod';
import { ReasoningStepSchema } from '@/server/domain/reasoning/reasoning.schema';

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'model']),
  text: z.string(),
  timestamp: z.number(),
  model: z.string().optional(),
  interrupted: z.boolean().optional(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
  reasoningSteps: z.array(ReasoningStepSchema).optional(),
});

export const SessionRecordSchema = z.object({
  title: z.string(),
  createdAt: z.number(),
  messages: z.array(MessageSchema),
});

export const SessionsFileSchema = z.record(z.string(), SessionRecordSchema);
