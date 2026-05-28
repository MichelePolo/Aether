import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders text content', () => {
    render(<Badge>logic</Badge>);
    expect(screen.getByText('logic')).toBeInTheDocument();
  });

  it('applies badge base class', () => {
    render(<Badge>x</Badge>);
    expect(screen.getByText('x')).toHaveClass('badge');
  });

  it.each([
    ['logic', /disclosure/],
    ['dispatch', /disclosure/],
    ['validation', /status-online/],
    ['context_fetch', /zinc/],
    ['mcp_query', /disclosure/],
    ['thinking', /disclosure/],
  ] as const)('applies %s variant colors', (variant, colorPattern) => {
    render(<Badge variant={variant}>x</Badge>);
    expect(screen.getByText('x').className).toMatch(colorPattern);
  });

  it('applies default variant when none specified', () => {
    render(<Badge>x</Badge>);
    expect(screen.getByText('x').className).toMatch(/zinc/);
  });
});
