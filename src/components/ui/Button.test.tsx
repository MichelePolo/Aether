import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not call onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies primary variant by default', () => {
    render(<Button>X</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-manipulation');
  });

  it('applies ghost variant when specified', () => {
    render(<Button variant="ghost">X</Button>);
    const btn = screen.getByRole('button');
    expect(btn).not.toHaveClass('bg-manipulation');
    expect(btn.className).toMatch(/hover:bg-zinc-800/);
  });

  it('applies danger variant when specified', () => {
    render(<Button variant="danger">X</Button>);
    expect(screen.getByRole('button').className).toMatch(/red/);
  });

  it('applies small size class', () => {
    render(<Button size="sm">X</Button>);
    expect(screen.getByRole('button').className).toMatch(/text-\[10px\]|text-xs/);
  });

  it('forwards ref to the underlying button', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>X</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('accepts additional className', () => {
    render(<Button className="extra-class">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('extra-class');
  });

  it('passes through type attribute', () => {
    render(<Button type="submit">X</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });
});
