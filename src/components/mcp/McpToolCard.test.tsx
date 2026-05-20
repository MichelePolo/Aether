import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpToolCard } from './McpToolCard';

const tool = {
  qualifiedName: 'mock.echo',
  serverId: 'M1',
  serverName: 'mock',
  tool: { name: 'echo', description: 'Returns input', inputSchema: { type: 'object' as const } },
  autoApprove: true,
};

describe('McpToolCard', () => {
  it('renders qualified name + description', () => {
    render(<McpToolCard tool={tool} onToggle={() => {}} />);
    expect(screen.getByText('mock.echo')).toBeInTheDocument();
    expect(screen.getByText('Returns input')).toBeInTheDocument();
  });

  it('toggle calls onToggle with inverted value', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<McpToolCard tool={tool} onToggle={onToggle} />);
    await user.click(screen.getByRole('checkbox', { name: /auto-approve/i }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
