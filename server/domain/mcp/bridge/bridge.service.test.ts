import { McpBridgeService } from './bridge.service';
import type { ProviderToolDecl } from '@/server/domain/dispatch/providers/provider.types';

const decl = (qualifiedName: string): ProviderToolDecl => ({
  qualifiedName,
  description: 'd',
  schema: { type: 'object', properties: {} },
});

const noopExec = async () => ({ ok: true as const, output: 'x' });

describe('McpBridgeService', () => {
  it('register returns a unique token resolving to the entry', () => {
    const svc = new McpBridgeService();
    const t1 = svc.register([decl('A.one')], noopExec);
    const t2 = svc.register([decl('B.two')], noopExec);
    expect(t1).not.toBe(t2);
    expect(svc.get(t1)?.tools[0]?.decl.qualifiedName).toBe('A.one');
    expect(svc.get(t2)?.tools[0]?.decl.qualifiedName).toBe('B.two');
  });

  it('normalizes qualified names to MCP-safe names, keeping the original decl', () => {
    const svc = new McpBridgeService();
    const token = svc.register([decl('Filesystem.read_file')], noopExec);
    const tool = svc.get(token)!.tools[0]!;
    expect(tool.name).toBe('Filesystem_read_file');
    expect(tool.decl.qualifiedName).toBe('Filesystem.read_file');
  });

  it('disambiguates colliding safe names', () => {
    const svc = new McpBridgeService();
    const token = svc.register([decl('a.b'), decl('a_b')], noopExec);
    const names = svc.get(token)!.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(2);
  });

  it('get returns null for unknown token', () => {
    expect(new McpBridgeService().get('nope')).toBeNull();
  });

  it('unregister removes the entry', () => {
    const svc = new McpBridgeService();
    const token = svc.register([decl('A.one')], noopExec);
    svc.unregister(token);
    expect(svc.get(token)).toBeNull();
  });

  it('expires entries after the TTL', () => {
    vi.useFakeTimers();
    try {
      const svc = new McpBridgeService(1000);
      const token = svc.register([decl('A.one')], noopExec);
      vi.advanceTimersByTime(1001);
      expect(svc.get(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
