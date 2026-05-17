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
  url: z.string(),
  status: z.enum(['online', 'offline', 'connecting']),
});

export const AetherContextSchema = z.object({
  systemInstruction: z.string(),
  skills: z.array(z.string()),
  tools: z.array(ToolSchema),
  mcpServers: z.array(McpServerSchema),
});

export const AetherContextPatchSchema = AetherContextSchema.partial().strict();
