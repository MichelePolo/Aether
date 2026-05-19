import { z } from 'zod';

export const McpToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.object({
    type: z.literal('object').optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.boolean().optional(),
  }).passthrough(),
});

export const ToolsListResultSchema = z.object({
  tools: z.array(McpToolSchema),
});

const ContentItemSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
}).passthrough();

export const ToolsCallResultSchema = z.object({
  content: z.array(ContentItemSchema).default([]),
  isError: z.boolean().optional(),
});

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
