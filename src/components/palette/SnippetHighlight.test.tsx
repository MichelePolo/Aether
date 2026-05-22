import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SnippetHighlight } from './SnippetHighlight';

describe('SnippetHighlight', () => {
  it('renders plain text when no markers are present', () => {
    render(<SnippetHighlight snippet="just plain text" />);
    expect(screen.getByText('just plain text')).toBeInTheDocument();
  });

  it('wraps marked segments in <mark> elements', () => {
    render(<SnippetHighlight snippet="hello «M»world«/M» today" />);
    const mark = screen.getByText('world');
    expect(mark.tagName).toBe('MARK');
    expect(mark.textContent).toBe('world');
  });

  it('renders literal HTML characters as text (no XSS surface)', () => {
    const { container } = render(
      <SnippetHighlight snippet="prefix <script>alert(1)</script> «M»danger«/M» suffix" />,
    );
    expect(container.querySelectorAll('script')).toHaveLength(0);
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(screen.getByText('danger').tagName).toBe('MARK');
  });

  it('handles multiple marks in one snippet', () => {
    render(<SnippetHighlight snippet="«M»foo«/M» middle «M»bar«/M»" />);
    const marks = document.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('foo');
    expect(marks[1].textContent).toBe('bar');
  });

  it('gracefully handles an unmatched open marker', () => {
    const { container } = render(<SnippetHighlight snippet="hello «M»world (no close)" />);
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(container.textContent).toContain('«M»world (no close)');
  });
});
