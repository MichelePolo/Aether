import { z } from 'zod';
import { isValidCron } from './next-run';

const CadenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cron'), expr: z.string().min(1).refine(isValidCron, 'invalid cron expression') }),
  z.object({ kind: z.literal('interval'), everyMs: z.number().int().min(60_000) }),
]);

const TargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prompt'), prompt: z.string().min(1), subAgent: z.string().min(1).optional() }),
  z.object({ kind: z.literal('swarm'), swarmId: z.string().min(1), input: z.string().optional() }),
]);

export const ScheduleCreateSchema = z.object({
  name: z.string().min(1),
  cadence: CadenceSchema,
  target: TargetSchema,
  autonomy: z.enum(['safe', 'trusted']).optional(),
  providerName: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export const ScheduleUpdateSchema = ScheduleCreateSchema.partial();
