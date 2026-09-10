import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { apiSecurity } from './api-security';
import { makeTestDb } from '@/server/test/test-db';
import { ContextStore } from '@/server/domain/context/context.store';
import { HistoryStore } from '@/server/domain/history/history.store';
import { exportEnvelopeSchema } from '@/server/domain/history/history.export';
import { createAttachmentsRoutes } from '@/server/routes/attachments.routes';
import { BuiltinMcpStore } from '@/server/domain/mcp/builtin/builtin.store';
import { normalizeToolResult } from '@/server/domain/mcp/tool-result';
import { HttpMcpConnection } from '@/server/domain/mcp/http-connection';
import { executeCommand } from '@/server/mcp/builtin/aether-shell.handler';
import { createRunCommand } from '@/server/domain/tdd/tdd.run-command';

const databases: ReturnType<typeof makeTestDb>[] = [];
function database() { const db = makeTestDb(); databases.push(db); return db; }
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.unstubAllGlobals(); });

describe('review security and persistence regressions', () => {
  it.each([
    { host: 'attacker.example', origin: undefined },
    { host: 'localhost', origin: 'https://attacker.example' },
    { host: 'localhost', origin: 'null' },
  ])('rejects browser access with Host $host Origin $origin', async ({ host, origin }) => {
    const app = express().use(apiSecurity()).get('/', (_req, res) => res.sendStatus(204));
    const req = request(app).get('/').set('Host', host);
    if (origin) req.set('Origin', origin);
    expect((await req).status).toBe(403);
  });

  it('allows same-origin loopback calls and rejects cross-site fetches', async () => {
    const app = express().use(apiSecurity()).get('/', (_req, res) => res.sendStatus(204));
    expect((await request(app).get('/').set('Host', 'localhost:1234').set('Origin', 'http://localhost:1234')).status).toBe(204);
    expect((await request(app).get('/').set('Host', 'localhost').set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
  });

  it('requires an exact bearer token for remote clients', () => {
    const middleware = apiSecurity({ allowedHosts: ['studio.local'], token: 'test-token' });
    const run = (authorization?: string) => {
      const headers: Record<string, string | undefined> = { host: 'studio.local', authorization };
      const req = { get: (k: string) => headers[k], socket: { remoteAddress: '192.0.2.1' }, protocol: 'http' };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }; const next = vi.fn();
      middleware(req as never, res as never, next); return { next, res };
    };
    expect(run().res.status).toHaveBeenCalledWith(403);
    expect(run('Bearer wrong-token').next).not.toHaveBeenCalled();
    expect(run('Bearer test-token').next).toHaveBeenCalledOnce();
  });

  it.each(['text/html', 'image/svg+xml', 'application/xhtml+xml'])('downloads %s with a sandbox and nosniff', async mime => {
    const store = new HistoryStore(database()); const session = await store.createEmpty();
    await store.append(session.id, { id: 'u', role: 'user', text: 'file', timestamp: 1, attachments: [{ id: 'a', name: 'payload', mime, size: 8, contentBase64: Buffer.from('<script>').toString('base64') }] });
    const app = express().use('/', createAttachmentsRoutes(store));
    const response = await request(app).get('/a');
    expect(response.headers['content-disposition']).toBe('attachment');
    expect(response.headers['content-type']).toContain('application/octet-stream');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain('sandbox');
  });

  it('roundtrips attachments including empty files and token usage through export/import', async () => {
    const store = new HistoryStore(database()); const session = await store.createEmpty();
    await store.append(session.id, { id: 'u', role: 'user', text: 'file', timestamp: 1, attachments: [
      { id: 'a', name: 'file.txt', mime: 'text/plain', size: 4, contentBase64: 'ZGF0YQ==' },
      { id: 'b', name: 'empty.txt', mime: 'text/plain', size: 0, contentBase64: '' },
    ] });
    await store.append(session.id, { id: 'm', role: 'model', text: 'done', timestamp: 2, tokensIn: 23, tokensOut: 5 });
    const envelope = exportEnvelopeSchema.parse(await store.exportSession(session.id));
    const imported = await store.importSession(envelope);
    const messages = await store.read(imported.id);
    expect(messages?.[1]).toMatchObject({ tokensIn: 23, tokensOut: 5 });
    expect((await store.getAttachmentBytes(messages![0].attachments![0].id))?.content.toString()).toBe('data');
    expect((await store.getAttachmentBytes(messages![0].attachments![1].id))?.content.length).toBe(0);
  });

  it('persists HTTP MCP headers encrypted and decrypts them after reopening the store', async () => {
    const db = database(); const key = Buffer.alloc(32, 7);
    const store = new ContextStore(db, key);
    await store.patch({ mcpServers: [{ id: 'http', name: 'remote', transport: 'http', status: 'offline', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secret' } }] });
    expect((await new ContextStore(db, key).read()).mcpServers[0].headers).toEqual({ Authorization: 'Bearer secret' });
    const row = db.prepare('SELECT headers_ciphertext FROM context_mcp_servers').get() as { headers_ciphertext: Buffer };
    expect(row.headers_ciphertext.toString()).not.toContain('secret');
    expect(() => new ContextStore(db, Buffer.alloc(32, 8)).read()).toThrow();
  });

  it('keeps builtin policy overrides independent by root after reopening', () => {
    const db = database(); const store = new BuiltinMcpStore(db);
    store.setToolPolicy('builtin:filesystem@/a', 'write_file', { autoApprove: true });
    store.setToolPolicy('builtin:filesystem@/b', 'write_file', { autoApprove: false });
    const reopened = new BuiltinMcpStore(db);
    expect(reopened.readToolPolicy('builtin:filesystem@/a', 'write_file')).toEqual({ autoApprove: true });
    expect(reopened.readToolPolicy('builtin:filesystem@/b', 'write_file')).toEqual({ autoApprove: false });
  });

  it('honors the HTTP MCP lifecycle, JSON results, session headers and tool errors', async () => {
    const calls: Array<{ method: string; headers: Headers; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method: init.method, headers: new Headers(init.headers), body });
      if (body?.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }, { headers: { 'mcp-session-id': 'session-1' } });
      if (body?.method === 'tools/call') return Response.json({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: 'permission denied' }] } });
      return new Response(null, { status: 202 });
    }));
    const connection = new HttpMcpConnection({ url: 'https://example.com/mcp', headers: { Authorization: 'Bearer test' } });
    await connection.initialize();
    expect(calls[0].body?.params).toMatchObject({ protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aether' } });
    expect(calls[1].body).toMatchObject({ method: 'notifications/initialized' });
    expect(calls[1].body).not.toHaveProperty('id');
    expect(await connection.callTool('test', {})).toMatchObject({ ok: false, error: 'permission denied' });
    expect(calls[2].headers.get('mcp-session-id')).toBe('session-1');
    expect(calls[2].headers.get('authorization')).toBe('Bearer test');
    await connection.close(); expect(calls.at(-1)?.method).toBe('DELETE');
    expect(normalizeToolResult({ isError: true, content: [{ type: 'text', text: 'failed' }] })).toEqual({ ok: false, error: 'failed' });
  });

  it('does not report a timeout as successful even if stdout says exit code: 0', async () => {
    const run = createRunCommand(executeCommand);
    const ctrl = new AbortController();
    const pending = run('node -e "console.log(\'exit code: 0\'); setInterval(()=>{},1000)"', undefined, ctrl.signal);
    setTimeout(() => ctrl.abort(), 200);
    const result = await pending;
    expect(result.exitCode).toBe(130);
  });

  it('reports timeout and signal termination through structured exit status', async () => {
    const timed = await executeCommand({ cmd: 'node -e "setInterval(()=>{},1000)"', timeout: 50 });
    expect(timed).toMatchObject({ isError: true, exitCode: 124, timedOut: true });
    if (process.platform !== 'win32') {
      const signalled = await executeCommand({ cmd: 'kill -TERM $$' });
      expect(signalled).toMatchObject({ isError: true, exitCode: 1, signal: 'SIGTERM' });
    }
  });
});
