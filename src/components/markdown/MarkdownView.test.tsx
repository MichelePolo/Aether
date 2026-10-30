import { render, screen } from '@testing-library/react';
import { MarkdownView } from './MarkdownView';

describe('MarkdownView', () => {
  it('renders Markdown as elements inside a .md container', () => {
    const { container } = render(<MarkdownView source={'# Title\n\n**bold** and `code`'} className="extra" />);
    expect(container.firstElementChild).toHaveClass('md', 'extra');
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('code')).toHaveTextContent('code');
  });

  it('renders links that open in a new tab', () => {
    render(<MarkdownView source="[site](https://example.com)" />);
    expect(screen.getByRole('link', { name: 'site' })).toHaveAttribute('target', '_blank');
  });

  it('handles partial Markdown from a streaming reply', () => {
    const { container } = render(<MarkdownView source={'Intro\n\n```ts\nconst a = 1'} />);
    // An unclosed fence runs to the end of the document (CommonMark).
    expect(container.querySelector('pre code')).toHaveTextContent('const a = 1');
    // An unclosed emphasis stays literal until it is closed.
    const { container: c2 } = render(<MarkdownView source="still **typing" />);
    expect(c2.querySelector('strong')).toBeNull();
    expect(c2).toHaveTextContent('still **typing');
  });

  it('keeps finished blocks when the source grows', () => {
    const { container, rerender } = render(<MarkdownView source={'First paragraph.\n\nSecond'} />);
    const first = container.querySelector('p');
    rerender(<MarkdownView source={'First paragraph.\n\nSecond paragraph, longer now.'} />);
    expect(container.querySelector('p')).toBe(first);
    expect(container.querySelectorAll('p')[1]).toHaveTextContent('Second paragraph, longer now.');
  });
});
