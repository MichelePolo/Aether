import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Panel } from './Panel';

describe('Panel', () => {
  it('renders children', () => {
    render(<Panel>content</Panel>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('uses panel class by default', () => {
    render(<Panel data-testid="p">x</Panel>);
    expect(screen.getByTestId('p')).toHaveClass('panel');
  });

  it('uses panel-inset class for inset variant', () => {
    render(<Panel variant="inset" data-testid="p">x</Panel>);
    expect(screen.getByTestId('p')).toHaveClass('panel-inset');
  });

  it('renders title when provided', () => {
    render(<Panel title="Section">body</Panel>);
    expect(screen.getByText('Section')).toBeInTheDocument();
    expect(screen.getByText('Section').className).toMatch(/mono-label/);
  });

  it('does not render title when not provided', () => {
    render(<Panel>body</Panel>);
    expect(screen.queryByText(/Section/)).not.toBeInTheDocument();
  });
});
