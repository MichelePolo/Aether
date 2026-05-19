import { z } from 'zod';
import { AetherContextSchema } from '@/server/domain/context/context.schema';

export const ProfileRecordSchema = z.object({
  name: z.string().min(1).max(100),
  createdAt: z.number(),
  updatedAt: z.number(),
  context: AetherContextSchema,
  thinkingEnabled: z.boolean(),
});

export const ProfilesFileSchema = z.record(z.string(), ProfileRecordSchema);

// Looser shape for import — allows files from older/different sources.
export const ProfileImportSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    context: AetherContextSchema,
    thinkingEnabled: z.boolean().optional(),
  })
  .passthrough();
