import { z } from 'zod';

export const ToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  status: z.enum(['online', 'offline']),
});

export const McpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  status: z.enum(['online', 'offline', 'connecting', 'error']),
});

const McpToolPolicySchema = z.object({ autoApprove: z.boolean() });

const StdioMcpSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});

const MockMcpSchema = z.object({
  transport: z.literal('mock'),
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
  ]),
);

export const AetherContextSchema = z.object({
  systemInstruction: z.string(),
  skills: z.array(z.string()),
  tools: z.array(ToolSchema),
  mcpServers: z.array(McpServerSchema),
});

export const AetherContextPatchSchema = AetherContextSchema.partial().strict();
