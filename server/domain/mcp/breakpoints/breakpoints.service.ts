import type { McpRegistry } from '@/server/domain/mcp/registry';
import type { McpToolPolicy } from '@/server/domain/context/context.types';
import { classifyTool } from './classify';
import type { CategoryMode } from './breakpoints.types';
import type { BreakpointPolicyStore } from './policy.store';

export interface BreakpointServiceDeps {
  mcpRegistry: Pick<McpRegistry, 'policy'>;
  policyStore: Pick<BreakpointPolicyStore, 'read'>;
}

export class BreakpointService {
  constructor(private readonly deps: BreakpointServiceDeps) {}

  async resolveDecision(input: {
    qualifiedName: string;
    args: Record<string, unknown>;
  }): Promise<CategoryMode> {
    const policy: McpToolPolicy = this.deps.mcpRegistry.policy(input.qualifiedName) ?? {};

    if (policy.autoApprove === true) return 'auto';
    if (policy.autoApprove === false) return 'gate';

    const classified = classifyTool({
      qualifiedName: input.qualifiedName,
      args: input.args,
      override: policy.category ? { category: policy.category } : undefined,
    });

    return this.deps.policyStore.read()[classified.category];
  }
}
