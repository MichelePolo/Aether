import { z } from 'zod';
import { ToolSchema } from '@/server/domain/context/context.schema';

export const SubAgentNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

export const SubAgentRecordSchema = z.object({
  name: SubAgentNameSchema,
  systemInstruction: z.string().max(8000),
  skills: z.array(z.string()).max(50),
  tools: z.array(ToolSchema).max(50),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const SubAgentsFileSchema = z.record(z.string(), SubAgentRecordSchema);

export const SubAgentCreateInputSchema = z.object({
  name: SubAgentNameSchema,
  systemInstruction: z.string().max(8000).default(''),
  skills: z.array(z.string()).max(50).default([]),
  tools: z.array(ToolSchema).max(50).default([]),
});

export const SubAgentUpdateInputSchema = SubAgentCreateInputSchema.partial();
