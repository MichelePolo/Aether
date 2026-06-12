import { z } from 'zod';

export const ToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  status: z.enum(['online', 'offline']),
});

const McpToolPolicySchema = z.object({
  autoApprove: z.boolean().optional(),
  category: z.enum(['safe', 'dangerous', 'external']).optional(),
});

/** Loose stored shape — accepts both legacy and slice-7 entries. The registry validates
 *  transport-specific requirements (e.g. `command` for stdio) at connect-time. */
export const McpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  status: z.enum(['online', 'offline', 'connecting', 'error']),
  transport: z.enum(['stdio', 'mock', 'http']).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  toolPolicies: z.record(z.string(), McpToolPolicySchema).optional(),
});

const StdioMcpSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});

const MockMcpSchema = z.object({
  transport: z.literal('mock'),
});

const HttpMcpSchema = z.object({
  transport: z.literal('http'),
  url: z.string().min(1),
});

const BaseMcpSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  url: z.string().optional(),
  status: z.enum(['offline', 'connecting', 'online', 'error']).default('offline'),
  toolPolicies: z.record(z.string(), McpToolPolicySchema).optional(),
});

export const McpServerConfigSchema = z.preprocess(
  (raw) => {
    if (raw && typeof raw === 'object' && !('transport' in (raw as Record<string, unknown>))) {
      return { ...(raw as Record<string, unknown>), transport: 'stdio' };
    }
    return raw;
  },
  z.discriminatedUnion('transport', [
    BaseMcpSchema.merge(StdioMcpSchema),
    BaseMcpSchema.merge(MockMcpSchema),
    BaseMcpSchema.merge(HttpMcpSchema),
  ]),
);

export const SkillSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
});

// Accept legacy plain-string skills (export envelopes, profiles) and normalize
// them to { name, enabled: true }.
const SkillEntrySchema = z.union([
  z.string().min(1).transform((name) => ({ name, enabled: true })),
  SkillSchema,
]);

export const AetherContextSchema = z.object({
  systemInstruction: z.string(),
  skills: z.array(SkillEntrySchema),
  tools: z.array(ToolSchema),
  mcpServers: z.array(McpServerSchema),
});

export const AetherContextPatchSchema = AetherContextSchema.partial().strict();
