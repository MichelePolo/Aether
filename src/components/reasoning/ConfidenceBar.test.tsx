import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ConfidenceBar } from './ConfidenceBar';

describe('ConfidenceBar', () => {
  it('renders null when confidence is undefined', () => {
    const { container } = render(<ConfidenceBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a bar with width proportional to confidence', () => {
    const { container } = render(<ConfidenceBar confidence={0.5} />);
    const bar = container.querySelector('[data-testid="confidence-fill"]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe('50%');
  });

  it('clamps confidence to [0,1]', () => {
    const { container, rerender } = render(<ConfidenceBar confidence={2} />);
    let bar = container.querySelector('[data-testid="confidence-fill"]') as HTMLElement;
    expect(bar.style.width).toBe('100%');
    rerender(<ConfidenceBar confidence={-0.5} />);
    bar = container.querySelector('[data-testid="confidence-fill"]') as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });
});
