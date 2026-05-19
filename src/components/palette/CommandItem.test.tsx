import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Plus } from 'lucide-react';
import { CommandItem } from './CommandItem';

describe('CommandItem', () => {
  it('renders label and shortcut hint when present', () => {
    render(<CommandItem label="New session" shortcut="⌘N" icon={Plus} />);
    expect(screen.getByText('New session')).toBeInTheDocument();
    expect(screen.getByText('⌘N')).toBeInTheDocument();
  });

  it('omits shortcut element when absent', () => {
    render(<CommandItem label="X" />);
    expect(screen.queryByTestId('command-item-shortcut')).toBeNull();
  });
});
