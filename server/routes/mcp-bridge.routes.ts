import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { McpBridgeService } from '@/server/domain/mcp/bridge/bridge.service';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const RpcRequest = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.number(), z.string()]).nullish(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const PROTOCOL_VERSION = '2025-03-26';

/**
 * Loopback streamable-HTTP MCP endpoint consumed by spawned agentic CLIs
 * (Codex via `-c mcp_servers.aether.url=...`). One POST route, JSON-RPC body,
 * plain-JSON responses (allowed by the streamable-HTTP transport). The
 * per-dispatch token in the path is the sole authorization — unknown or
 * expired tokens 404 without revealing anything.
 */
export function createMcpBridgeRoutes(service: McpBridgeService): Router {
  const router = Router();

  router.post(
    '/:token',
    asyncHandler(async (req, res) => {
      const entry = service.get(req.params.token as string);
      if (!entry) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'unknown bridge token' } });
        return;
      }
      const parsed = RpcRequest.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'invalid JSON-RPC request' },
        });
        return;
      }
      const { id, method, params } = parsed.data;
      const reply = (result: unknown): void => {
        res.json({ jsonrpc: '2.0', id: id ?? null, result });
      };

      if (method === 'initialize') {
        reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'aether-bridge', version: '1.0.0' },
        });
        return;
      }
      if (method.startsWith('notifications/')) {
        res.status(202).end();
        return;
      }
      if (method === 'tools/list') {
        reply({
          tools: entry.tools.map((t) => ({
            name: t.name,
            description: t.decl.description ?? '',
            inputSchema: { type: 'object', ...t.decl.schema },
          })),
        });
        return;
      }
      if (method === 'tools/call') {
        const name = typeof params?.name === 'string' ? params.name : '';
        const tool = entry.tools.find((t) => t.name === name);
        if (!tool) {
          res.json({
            jsonrpc: '2.0',
            id: id ?? null,
            error: { code: -32602, message: `unknown tool: ${name}` },
          });
          return;
        }
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        const outcome = await entry.runToolCall({
          qualifiedName: tool.decl.qualifiedName,
          args,
        });
        if (outcome.ok) {
          const text =
            typeof outcome.output === 'string'
              ? outcome.output
              : JSON.stringify(outcome.output ?? {});
          reply({ content: [{ type: 'text', text }] });
        } else {
          reply({
            content: [{ type: 'text', text: outcome.error ?? 'tool failed' }],
            isError: true,
          });
        }
        return;
      }
      res.json({
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code: -32601, message: `method not supported: ${method}` },
      });
    }),
  );

  return router;
}
