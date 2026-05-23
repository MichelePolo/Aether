#!/usr/bin/env node
import { executeCommand } from './aether-shell.handler';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
};

function send(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

async function handle(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const base = { jsonrpc: '2.0' as const, id: req.id };

  if (req.method === 'initialize') {
    return {
      ...base,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'aether-shell', version: '0.1.0' },
      },
    };
  }

  if (req.method === 'tools/list') {
    return {
      ...base,
      result: {
        tools: [
          {
            name: 'execute_command',
            description:
              'Run a shell command. 30s default timeout, 1 MB output cap, dangerous patterns blocked.',
            inputSchema: {
              type: 'object',
              properties: {
                cmd: { type: 'string', description: 'Command line to execute' },
                cwd: { type: 'string', description: 'Optional working directory' },
                timeout: {
                  type: 'number',
                  description: 'Timeout in ms (default 30000, max 120000)',
                },
              },
              required: ['cmd'],
            },
          },
        ],
      },
    };
  }

  if (req.method === 'tools/call') {
    const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    if (params.name !== 'execute_command') {
      return { ...base, error: { code: -32601, message: `Unknown tool: ${params.name}` } };
    }
    const args = (params.arguments ?? {}) as { cmd?: string; cwd?: string; timeout?: number };
    if (typeof args.cmd !== 'string') {
      return { ...base, error: { code: -32602, message: 'cmd (string) required' } };
    }
    const result = await executeCommand({ cmd: args.cmd, cwd: args.cwd, timeout: args.timeout });
    return { ...base, result };
  }

  return { ...base, error: { code: -32601, message: `Unknown method: ${req.method}` } };
}

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let idx: number;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line) as JsonRpcRequest;
    } catch {
      send({ jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    void handle(req).then(send);
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
