#!/usr/bin/env node
// Minimal MCP-shaped server used as a stdio test fixture.
// Methods: initialize → {}, tools/list → { tools: [echo] },
// tools/call name=echo → { content: [{type:'text', text: args.message}] },
// tools/call name=fail → JSON-RPC error.

let buf = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    respond(req);
  }
});

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function respond(req) {
  const { id, method, params } = req;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') {
    return send({
      jsonrpc: '2.0', id,
      result: { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }] },
    });
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (name === 'fail') {
      return send({ jsonrpc: '2.0', id, error: { code: -32000, message: 'intentional failure' } });
    }
    if (name === 'echo') {
      return send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: String(args.message ?? '') }] },
      });
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown tool' } });
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
}
