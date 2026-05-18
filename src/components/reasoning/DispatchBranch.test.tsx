import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchBranch } from './DispatchBranch';

describe('DispatchBranch', () => {
  it('renders null when subAgent is undefined', () => {
    const { container } = render(<DispatchBranch />);
    expect(container.firstChild).toBeNull();
  });

  it('renders pill with subAgent label', () => {
    render(<DispatchBranch subAgent="Coder_X1" />);
    expect(screen.getByText('Coder_X1')).toBeInTheDocument();
  });
});
