import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('renders an accessible button with label', () => {
    render(<IconButton label="Settings"><span data-testid="icon" /></IconButton>);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('sets aria-label from label prop', () => {
    render(<IconButton label="Close"><span /></IconButton>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Close');
  });

  it('also sets title for tooltip', () => {
    render(<IconButton label="Reset"><span /></IconButton>);
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Reset');
  });

  it('applies default variant', () => {
    render(<IconButton label="X"><span /></IconButton>);
    expect(screen.getByRole('button')).toHaveClass('icon-btn');
  });

  it('applies active variant', () => {
    render(<IconButton label="X" variant="active"><span /></IconButton>);
    expect(screen.getByRole('button').className).toMatch(/bg-zinc-800/);
  });

  it('applies danger variant', () => {
    render(<IconButton label="X" variant="danger"><span /></IconButton>);
    expect(screen.getByRole('button').className).toMatch(/status-error/);
  });

  it('handles clicks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton label="X" onClick={onClick}><span /></IconButton>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
