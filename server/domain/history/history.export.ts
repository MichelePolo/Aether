import { z } from 'zod';
import type { SessionRecord } from './history.types';

export const EXPORT_VERSION = 1 as const;

// Inner shapes: we keep them lenient (no .strict()) so unknown keys are
// silently dropped at every nesting level. The version contract is enforced
// only at the top level via the literal `app` and `version`.

const toolCallTraceSchema = z.object({
  id: z.string(),
  qualifiedName: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  result: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number(),
  progressNote: z.string().optional(),
});

const reasoningStepSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  content: z.string(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  subAgent: z.string().optional(),
  timestamp: z.number(),
  toolCall: toolCallTraceSchema.optional(),
});

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'model']),
  text: z.string(),
  timestamp: z.number(),
  model: z.string().optional(),
  interrupted: z.boolean().optional(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
  reasoningSteps: z.array(reasoningStepSchema).optional(),
});

const sessionSchema = z.object({
  title: z.string(),
  createdAt: z.number(),
  providerName: z.string().optional(),
  messages: z.array(messageSchema),
});

export const exportEnvelopeSchema = z.object({
  app: z.literal('aether'),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.number(),
  session: sessionSchema,
});

export type ExportEnvelope = z.infer<typeof exportEnvelopeSchema>;

export function wrap(record: SessionRecord, exportedAt: number): ExportEnvelope {
  return {
    app: 'aether',
    version: EXPORT_VERSION,
    exportedAt,
    session: record,
  };
}

const SLUG_MAX = 60;

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}

function formatStamp(ts: number): string {
  const d = new Date(ts);
  return (
    `${d.getUTCFullYear()}` +
    pad(d.getUTCMonth() + 1, 2) +
    pad(d.getUTCDate(), 2) +
    '-' +
    pad(d.getUTCHours(), 2) +
    pad(d.getUTCMinutes(), 2)
  );
}

export function slugifyFilename(title: string, exportedAt: number): string {
  const lower = (title || '').toLowerCase();
  const slug = lower
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX);
  const safe = slug || 'untitled';
  return `aether-session-${safe}-${formatStamp(exportedAt)}.json`;
}
