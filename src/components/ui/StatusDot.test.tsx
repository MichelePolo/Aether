import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusDot } from './StatusDot';

describe('StatusDot', () => {
  it('renders with status-dot class', () => {
    render(<StatusDot status="online" label="Server" />);
    expect(screen.getByTitle('Server: online')).toHaveClass('status-dot');
  });

  it.each(['online', 'offline', 'connecting', 'error'] as const)('renders for status %s', (s) => {
    render(<StatusDot status={s} label="X" />);
    expect(screen.getByTitle(`X: ${s}`)).toBeInTheDocument();
  });

  it('uses green color for online', () => {
    render(<StatusDot status="online" label="X" />);
    const dot = screen.getByTitle('X: online');
    expect(dot.className).toMatch(/status-online|green/);
  });

  it('uses yellow color and pulse animation for connecting', () => {
    render(<StatusDot status="connecting" label="X" />);
    const dot = screen.getByTitle('X: connecting');
    expect(dot.className).toMatch(/connecting|yellow/);
    expect(dot.className).toMatch(/animate-pulse/);
  });

  it('uses zinc color for offline', () => {
    render(<StatusDot status="offline" label="X" />);
    expect(screen.getByTitle('X: offline').className).toMatch(/offline|zinc/);
  });

  it('uses red color for error', () => {
    render(<StatusDot status="error" label="X" />);
    expect(screen.getByTitle('X: error').className).toMatch(/red|error/);
  });
});
