import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CodexProvider, parseCodexEvent } from './codex.provider';
import { McpBridgeService } from '@/server/domain/mcp/bridge/bridge.service';
import type { ProviderChunk, ProviderRequest } from './provider.types';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'codex-events',
);
const FAKE = path.join(FIXTURES, 'fake-codex.cjs');

function baseReq(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return { systemInstruction: 'sys', history: [], userMessage: 'hi', ...overrides };
}

/** spawnImpl that runs the fake codex script and records the argv the
 *  provider intended for the real binary. */
function fakeSpawn(mode: string, fixture?: string) {
  const captured: { binary?: string; args?: string[] } = {};
  const impl = ((binary: string, args: string[], opts: object) => {
    captured.binary = binary;
    captured.args = args;
    const scriptArgs = [FAKE, mode, ...(fixture ? [path.join(FIXTURES, fixture)] : [])];
    return spawn(process.execPath, scriptArgs, opts);
  }) as typeof spawn;
  return { impl, captured };
}

function makeProvider(mode: string, fixture?: string, bridge = new McpBridgeService()) {
  const { impl, captured } = fakeSpawn(mode, fixture);
  const provider = new CodexProvider({
    model: 'gpt-5.6-sol',
    binaryPath: '/usr/bin/codex',
    bridgeBaseUrl: () => 'http://127.0.0.1:3000/api/mcp-bridge',
    bridge,
    spawnImpl: impl,
  });
  return { provider, captured, bridge };
}

async function collect(
  provider: CodexProvider,
  req: ProviderRequest,
  signal = new AbortController().signal,
): Promise<ProviderChunk[]> {
  const chunks: ProviderChunk[] = [];
  for await (const c of provider.stream(req, signal)) chunks.push(c);
  return chunks;
}

describe('parseCodexEvent', () => {
  it('maps agent_message items to text', () => {
    expect(
      parseCodexEvent('{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}'),
    ).toEqual({ kind: 'text', text: 'hi' });
  });

  it('maps reasoning items to thinking (both slugs)', () => {
    for (const t of ['reasoning', 'agent_reasoning']) {
      expect(
        parseCodexEvent(`{"type":"item.completed","item":{"type":"${t}","text":"hm"}}`),
      ).toEqual({ kind: 'thinking', text: 'hm' });
    }
  });

  it('maps turn.completed usage', () => {
    expect(
      parseCodexEvent('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":4}}'),
    ).toEqual({ kind: 'done', usage: { totalTokens: 14, inputTokens: 10, outputTokens: 4 } });
  });

  it('omits usage when tokens are missing', () => {
    expect(parseCodexEvent('{"type":"turn.completed"}')).toEqual({ kind: 'done' });
  });

  it('maps turn.failed and error events', () => {
    expect(parseCodexEvent('{"type":"turn.failed","error":{"message":"limit"}}')).toEqual({
      kind: 'error',
      message: 'limit',
    });
    expect(parseCodexEvent('{"type":"error","message":"nope"}')).toEqual({
      kind: 'error',
      message: 'nope',
    });
  });

  it('returns null for non-JSON, unknown types and textless items', () => {
    expect(parseCodexEvent('garbage')).toBeNull();
    expect(parseCodexEvent('{"type":"turn.started"}')).toBeNull();
    expect(parseCodexEvent('{"type":"item.started","item":{"type":"agent_message","text":""}}')).toBeNull();
    expect(
      parseCodexEvent('{"type":"item.completed","item":{"type":"command_execution"}}'),
    ).toBeNull();
    expect(parseCodexEvent('null')).toBeNull();
  });
});

describe('CodexProvider.stream', () => {
  it('streams text and done with usage from the happy fixture', async () => {
    const { provider } = makeProvider('emit', 'happy.jsonl');
    const chunks = await collect(provider, baseReq());
    expect(chunks).toEqual([
      { type: 'text', text: 'Hello from Codex' },
      { type: 'done', usage: { totalTokens: 150, inputTokens: 120, outputTokens: 30 } },
    ]);
  });

  it('builds isolated read-only argv with stdin prompt marker', async () => {
    const { provider, captured } = makeProvider('emit', 'happy.jsonl');
    await collect(provider, baseReq());
    expect(captured.binary).toBe('/usr/bin/codex');
    const args = captured.args ?? [];
    for (const expected of ['exec', '--json', '--ephemeral', '--ignore-user-config']) {
      expect(args).toContain(expected);
    }
    expect(args.join(' ')).toContain('-s read-only');
    expect(args.join(' ')).toContain('-m gpt-5.6-sol');
    expect(args[args.length - 1]).toBe('-');
    expect(args.join(' ')).not.toContain('mcp_servers');
  });

  it('emits thinking only when req.thinking is true', async () => {
    const on = await collect(makeProvider('emit', 'thinking.jsonl').provider, baseReq({ thinking: true }));
    expect(on[0]).toEqual({ type: 'thinking', text: 'pondering the request' });
    const off = await collect(makeProvider('emit', 'thinking.jsonl').provider, baseReq());
    expect(off.some((c) => c.type === 'thinking')).toBe(false);
  });

  it('registers bridge tools, passes the tokened URL, and unregisters after', async () => {
    const bridge = new McpBridgeService();
    const registerSpy = vi.spyOn(bridge, 'register');
    const unregisterSpy = vi.spyOn(bridge, 'unregister');
    const { provider, captured } = makeProvider('emit', 'happy.jsonl', bridge);
    const runToolCall = vi.fn().mockResolvedValue({ ok: true, output: 'x' });
    await collect(
      provider,
      baseReq({
        mcpTools: [{ qualifiedName: 'T.a', schema: { type: 'object', properties: {} } }],
        runToolCall,
      }),
    );
    expect(registerSpy).toHaveBeenCalledOnce();
    const token = registerSpy.mock.results[0]!.value as string;
    const cfg = (captured.args ?? []).find((a) => a.startsWith('mcp_servers.aether.url='));
    expect(cfg).toBe(`mcp_servers.aether.url="http://127.0.0.1:3000/api/mcp-bridge/${token}"`);
    expect(unregisterSpy).toHaveBeenCalledWith(token);
    expect(bridge.get(token)).toBeNull();
  });

  it('skips the bridge when there are no tools', async () => {
    const bridge = new McpBridgeService();
    const registerSpy = vi.spyOn(bridge, 'register');
    await collect(makeProvider('emit', 'happy.jsonl', bridge).provider, baseReq());
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('throws the turn.failed message (rate limit surfaced verbatim)', async () => {
    const { provider } = makeProvider('emit', 'failed.jsonl');
    await expect(collect(provider, baseReq())).rejects.toThrow(
      /Codex error: You've hit your usage limit/,
    );
  });

  it('throws with stderr tail on non-zero exit without a done event', async () => {
    const { provider } = makeProvider('fail');
    await expect(collect(provider, baseReq())).rejects.toThrow(/boom: auth expired/);
  });

  it('abort mid-stream kills the child and ends iteration without done', async () => {
    const { provider } = makeProvider('hang', 'hang.jsonl');
    const aborter = new AbortController();
    const chunks: ProviderChunk[] = [];
    for await (const c of provider.stream(baseReq(), aborter.signal)) {
      chunks.push(c);
      aborter.abort();
    }
    expect(chunks).toEqual([{ type: 'text', text: 'partial output' }]);
  }, 10_000);
});
