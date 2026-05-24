#!/usr/bin/env node
// Minimal MCP-shaped server used as a stdio test fixture.
// Mirrors the real @modelcontextprotocol SDK's handshake contract so the client
// is tested against the same strictness it faces in production:
//   - initialize REQUIRES params.protocolVersion (string), params.capabilities
//     (object) and params.clientInfo (object); otherwise it returns -32602.
//   - tools/list is refused with -32002 until notifications/initialized arrives.
// Methods: initialize, tools/list → { tools: [echo, slow] },
// tools/call name=echo → { content: [{type:'text', text: args.message}] },
// tools/call name=fail → JSON-RPC error.

let initializedReceived = false;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

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
  if (method === 'initialize') {
    if (
      typeof params?.protocolVersion !== 'string' ||
      !isObject(params?.capabilities) ||
      !isObject(params?.clientInfo)
    ) {
      return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'invalid initialize params' } });
    }
    return send({
      jsonrpc: '2.0', id,
      result: { protocolVersion: params.protocolVersion, capabilities: {}, serverInfo: { name: 'echo', version: '0' } },
    });
  }
  if (method === 'notifications/initialized') {
    initializedReceived = true;
    return; // notification, no response
  }
  if (method === 'tools/list') {
    if (!initializedReceived) {
      return send({ jsonrpc: '2.0', id, error: { code: -32002, message: 'not initialized' } });
    }
    return send({
      jsonrpc: '2.0', id,
      result: { tools: [
        { name: 'echo', description: 'echo', inputSchema: { type: 'object' } },
        { name: 'slow', description: 'two-progress slow', inputSchema: { type: 'object' } },
      ] },
    });
  }
  if (method === 'notifications/cancelled') {
    return; // JSON-RPC notifications have no id; accept and ignore
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
    if (name === 'slow') {
      send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: id, progress: 1, total: 2, message: 'step 1' } });
      send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: id, progress: 2, total: 2, message: 'step 2' } });
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'done' }] } });
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown tool' } });
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
}
