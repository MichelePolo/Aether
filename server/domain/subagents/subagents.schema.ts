import { z } from 'zod';
import { ToolSchema } from '@/server/domain/context/context.schema';

export const SubAgentNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

// Stored names may include collision suffixes like "designer (2)"
const SubAgentStoredNameSchema = z.string().min(1).max(80);

export const SubAgentRecordSchema = z.object({
  name: SubAgentStoredNameSchema,
  systemInstruction: z.string().max(8000),
  skills: z.array(z.string()).max(50),
  tools: z.array(ToolSchema).max(50),
  model: z.string().max(120).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const SubAgentsFileSchema = z.record(z.string(), SubAgentRecordSchema);

export const SubAgentCreateInputSchema = z.object({
  name: SubAgentNameSchema,
  systemInstruction: z.string().max(8000).default(''),
  skills: z.array(z.string()).max(50).default([]),
  tools: z.array(ToolSchema).max(50).default([]),
  model: z.string().max(120).optional(),
});

// A true partial PATCH: every field optional with NO create-defaults. Reusing
// `SubAgentCreateInputSchema.partial()` would keep the `.default('')`/`.default([])`,
// so a PATCH omitting a field would parse to `''`/`[]` and the store's
// `patch.x ?? current` merge would silently wipe systemInstruction/skills/tools
// on every partial edit (e.g. changing only the model). Keeping fields plain
// `.optional()` means an omitted field stays `undefined` → the store preserves it.
export const SubAgentUpdateInputSchema = z.object({
  name: SubAgentNameSchema.optional(),
  systemInstruction: z.string().max(8000).optional(),
  skills: z.array(z.string()).max(50).optional(),
  tools: z.array(ToolSchema).max(50).optional(),
  model: z.string().max(120).optional(),
});
