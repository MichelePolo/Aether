import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McpToolCard } from './McpToolCard';
import type { LiveTool } from '@/src/types/mcp.types';

const baseTool: LiveTool = {
  qualifiedName: 'fs.write_file',
  serverId: 'srv-1',
  serverName: 'fs',
  autoApprove: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: { name: 'write_file', description: 'Write a file', inputSchema: {} } as any,
};

describe('McpToolCard 4-state policy select', () => {
  it('renders qualified name + description', () => {
    render(<McpToolCard tool={baseTool} onPolicyChange={() => {}} />);
    expect(screen.getByText('fs.write_file')).toBeInTheDocument();
    expect(screen.getByText('Write a file')).toBeInTheDocument();
  });

  it('renders a select with 4 options', () => {
    render(<McpToolCard tool={baseTool} onPolicyChange={() => {}} />);
    const select = screen.getByLabelText(/policy for fs.write_file/i) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.value);
    expect(labels).toEqual(['auto', 'safe', 'dangerous', 'external']);
  });

  it('dispatches { category: "dangerous" } when "Dangerous" is selected', () => {
    const onPolicyChange = vi.fn();
    render(<McpToolCard tool={baseTool} onPolicyChange={onPolicyChange} />);
    fireEvent.change(screen.getByLabelText(/policy for fs.write_file/i), {
      target: { value: 'dangerous' },
    });
    expect(onPolicyChange).toHaveBeenCalledWith({ category: 'dangerous' });
  });

  it('dispatches { autoApprove: true } when "Auto-approve" is selected', () => {
    const onPolicyChange = vi.fn();
    const tool = { ...baseTool, category: 'safe' as const };
    render(<McpToolCard tool={tool} onPolicyChange={onPolicyChange} />);
    fireEvent.change(screen.getByLabelText(/policy for fs.write_file/i), {
      target: { value: 'auto' },
    });
    expect(onPolicyChange).toHaveBeenCalledWith({ autoApprove: true });
  });
});
