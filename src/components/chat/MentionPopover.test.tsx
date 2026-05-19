import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MentionPopover } from './MentionPopover';
import type { SubAgentMeta } from '@/src/types/subagent.types';

const items: SubAgentMeta[] = [
  { id: 'a', name: 'designer', createdAt: 1, updatedAt: 1 },
  { id: 'b', name: 'coder', createdAt: 1, updatedAt: 1 },
];

describe('MentionPopover', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <MentionPopover open={false} items={items} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders item names when open', () => {
    render(<MentionPopover open items={items} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByText('designer')).toBeInTheDocument();
    expect(screen.getByText('coder')).toBeInTheDocument();
  });

  it('Enter on highlighted item calls onSelect', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MentionPopover open items={items} onSelect={onSelect} onClose={() => {}} />);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('designer');
  });

  it('ArrowDown then Enter selects second item', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MentionPopover open items={items} onSelect={onSelect} onClose={() => {}} />);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('coder');
  });

  it('Escape calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MentionPopover open items={items} onSelect={() => {}} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('empty items shows placeholder', () => {
    render(<MentionPopover open items={[]} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/no sub-agents/i)).toBeInTheDocument();
  });
});
