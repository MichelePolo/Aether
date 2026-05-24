import type { LiveTool } from '@/src/types/mcp.types';
import type { McpToolPolicy } from '@/server/domain/context/context.types';
import type { ToolCategory } from '@/src/types/breakpoints.types';

export interface McpToolCardProps {
  tool: LiveTool;
  onPolicyChange: (policy: McpToolPolicy) => void;
}

type SelectValue = 'auto' | ToolCategory;

function currentValue(tool: LiveTool): SelectValue {
  if (tool.autoApprove) return 'auto';
  return tool.category ?? 'safe';
}

export function McpToolCard({ tool, onPolicyChange }: McpToolCardProps) {
  const value = currentValue(tool);
  return (
    <div className="ml-2 p-1.5 rounded bg-zinc-900/40 border border-border-subtle/40 text-[10px] font-mono">
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-300 truncate">{tool.qualifiedName}</span>
        <select
          aria-label={`policy for ${tool.qualifiedName}`}
          value={value}
          onChange={(e) => {
            const v = e.target.value as SelectValue;
            if (v === 'auto') onPolicyChange({ autoApprove: true });
            else onPolicyChange({ category: v });
          }}
          className="bg-zinc-950 text-zinc-300 border border-border-subtle rounded px-1 py-0.5"
        >
          <option value="auto">Auto-approve</option>
          <option value="safe">Safe</option>
          <option value="dangerous">Dangerous</option>
          <option value="external">External</option>
        </select>
      </div>
      {tool.tool.description && (
        <div className="mt-0.5 text-[9px] text-zinc-600 truncate">{tool.tool.description}</div>
      )}
    </div>
  );
}
