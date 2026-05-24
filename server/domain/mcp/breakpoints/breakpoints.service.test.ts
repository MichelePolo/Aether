import { describe, it, expect } from 'vitest';
import { BreakpointService } from './breakpoints.service';
import type { McpToolPolicy } from '@/server/domain/context/context.types';
import type { BreakpointPolicy } from './breakpoints.types';

function makeService(opts: {
  policy?: McpToolPolicy;
  bp?: Partial<BreakpointPolicy>;
}) {
  const bp: BreakpointPolicy = {
    safe: 'auto', dangerous: 'gate', external: 'gate', ...opts.bp,
  };
  return new BreakpointService({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpRegistry: { policy: () => opts.policy ?? {} } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    policyStore: { read: () => bp } as any,
  });
}

describe('BreakpointService.resolveDecision', () => {
  it('per-tool autoApprove=true → auto regardless of category', async () => {
    const svc = makeService({ policy: { autoApprove: true } });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.delete_file', args: {} });
    expect(mode).toBe('auto');
  });

  it('per-tool autoApprove=false → gate regardless of category', async () => {
    const svc = makeService({ policy: { autoApprove: false } });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.read_file', args: {} });
    expect(mode).toBe('gate');
  });

  it('per-tool category override + global policy → resolves via category', async () => {
    const svc = makeService({
      policy: { category: 'external' },
      bp: { external: 'auto' },
    });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.read_file', args: {} });
    expect(mode).toBe('auto');
  });

  it('no per-tool config + heuristic dangerous + dangerous=gate → gate', async () => {
    const svc = makeService({ policy: undefined });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.write_file', args: {} });
    expect(mode).toBe('gate');
  });

  it('no per-tool config + heuristic dangerous + dangerous=auto → auto', async () => {
    const svc = makeService({ policy: undefined, bp: { dangerous: 'auto' } });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.write_file', args: {} });
    expect(mode).toBe('auto');
  });

  it('no per-tool config + safe + safe=auto → auto (default path)', async () => {
    const svc = makeService({ policy: undefined });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.read_file', args: {} });
    expect(mode).toBe('auto');
  });
});
