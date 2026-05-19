import type { LiveTool } from '@/src/types/mcp.types';

export interface McpToolCardProps {
  tool: LiveTool;
  onToggle: (newAutoApprove: boolean) => void;
}

export function McpToolCard({ tool, onToggle }: McpToolCardProps) {
  return (
    <div className="ml-2 p-1.5 rounded bg-zinc-900/40 border border-border-subtle/40 text-[10px] font-mono">
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-300 truncate">{tool.qualifiedName}</span>
        <label className="flex items-center gap-1 text-zinc-500 cursor-pointer">
          <input
            type="checkbox"
            aria-label={`auto-approve ${tool.qualifiedName}`}
            checked={tool.autoApprove}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span>auto</span>
        </label>
      </div>
      {tool.tool.description && (
        <div className="mt-0.5 text-[9px] text-zinc-600 truncate">{tool.tool.description}</div>
      )}
    </div>
  );
}
