import { chatMarkdown, linkAttributes } from './markdown';

describe('chatMarkdown', () => {
  it('opens links outside the app', () => {
    expect(chatMarkdown.render('[docs](https://example.com)')).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>',
    );
  });

  it('also targets GFM autolinks', () => {
    expect(chatMarkdown.render('see https://example.com')).toContain('target="_blank"');
  });

  it('renders raw HTML from model output as text', () => {
    const html = chatMarkdown.render('<img src=x onerror=alert(1)> and <script>alert(1)</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops javascript: URLs', () => {
    expect(chatMarkdown.render('[x](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('supports GFM tables, task lists and strikethrough', () => {
    const html = chatMarkdown.render('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~old~~');
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<del>old</del>');
  });

  it('adds no attributes to other nodes', () => {
    expect(linkAttributes({ type: 'paragraph', children: [] } as never)).toBeNull();
  });
});
