#!/usr/bin/env node
import {
  gitStatus, gitDiff, gitAdd, gitCommit, gitCheckout, gitRestore,
} from './aether-git.handler';

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

const CWD = process.argv[2] || process.cwd();

function send(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

const TOOLS = [
  { name: 'git_status', description: 'Show working-tree status (porcelain v2).', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'git_diff', description: 'Show a diff. staged=true for staged changes; optional path.', inputSchema: { type: 'object', properties: { staged: { type: 'boolean' }, path: { type: 'string' } }, required: [] } },
  { name: 'git_add', description: 'Stage the given paths.', inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } }, required: ['paths'] } },
  { name: 'git_commit', description: 'Commit staged changes with a message.', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
  { name: 'git_checkout', description: 'Switch to a branch; create=true makes a new branch.', inputSchema: { type: 'object', properties: { branch: { type: 'string' }, create: { type: 'boolean' } }, required: ['branch'] } },
  { name: 'git_restore', description: 'Discard changes in the given paths. staged=true unstages.', inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } }, staged: { type: 'boolean' } }, required: ['paths'] } },
];

async function handle(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const base = { jsonrpc: '2.0' as const, id: req.id };

  if (req.method === 'initialize') {
    return {
      ...base,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'aether-git', version: '0.1.0' },
      },
    };
  }

  if (req.method === 'tools/list') {
    return { ...base, result: { tools: TOOLS } };
  }

  if (req.method === 'tools/call') {
    const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    switch (params.name) {
      case 'git_status': return { ...base, result: await gitStatus(CWD) };
      case 'git_diff': return { ...base, result: await gitDiff(args, CWD) };
      case 'git_add': return { ...base, result: await gitAdd(args, CWD) };
      case 'git_commit': return { ...base, result: await gitCommit(args, CWD) };
      case 'git_checkout': return { ...base, result: await gitCheckout(args, CWD) };
      case 'git_restore': return { ...base, result: await gitRestore(args, CWD) };
      default: return { ...base, error: { code: -32601, message: `Unknown tool: ${params.name}` } };
    }
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
