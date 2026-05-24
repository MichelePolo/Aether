import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DiffView } from './DiffView';

describe('DiffView', () => {
  it('renders identical text with no add/remove lines', () => {
    const { container } = render(
      <DiffView oldText="alpha\nbeta\n" newText="alpha\nbeta\n" path="/x" />,
    );
    expect(container.querySelectorAll('[data-diff="add"]').length).toBe(0);
    expect(container.querySelectorAll('[data-diff="remove"]').length).toBe(0);
  });

  it('shows added lines when newText has extra lines', () => {
    const { container } = render(
      <DiffView oldText="a\n" newText="a\nb\n" path="/x" />,
    );
    expect(container.querySelectorAll('[data-diff="add"]').length).toBeGreaterThanOrEqual(1);
  });

  it('shows removed lines when oldText has extra lines', () => {
    const { container } = render(
      <DiffView oldText="a\nb\n" newText="a\n" path="/x" />,
    );
    expect(container.querySelectorAll('[data-diff="remove"]').length).toBeGreaterThanOrEqual(1);
  });

  it('shows both adds and removes for changed line', () => {
    const { container } = render(
      <DiffView oldText="hello\n" newText="world\n" path="/x" />,
    );
    expect(container.querySelectorAll('[data-diff="add"]').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('[data-diff="remove"]').length).toBeGreaterThanOrEqual(1);
  });
});
