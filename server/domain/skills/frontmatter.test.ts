import { parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
  it('extracts name and description from a YAML frontmatter block', () => {
    const md = ['---', 'name: my-skill', 'description: Does a thing', '---', '', '# Body'].join('\n');
    expect(parseFrontmatter(md)).toEqual({ name: 'my-skill', description: 'Does a thing' });
  });

  it('strips surrounding quotes from values', () => {
    const md = ['---', 'name: "quoted"', "description: 'single'", '---'].join('\n');
    expect(parseFrontmatter(md)).toEqual({ name: 'quoted', description: 'single' });
  });

  it('returns {} when there is no frontmatter block', () => {
    expect(parseFrontmatter('# Just a heading\n')).toEqual({});
  });

  it('returns {} when the opening fence is not on the first line', () => {
    expect(parseFrontmatter('\n---\nname: x\n---')).toEqual({});
  });

  it('ignores keys other than name/description', () => {
    const md = ['---', 'name: a', 'version: 2', 'description: b', '---'].join('\n');
    expect(parseFrontmatter(md)).toEqual({ name: 'a', description: 'b' });
  });

  it('returns partial result when description is missing', () => {
    const md = ['---', 'name: only-name', '---'].join('\n');
    expect(parseFrontmatter(md)).toEqual({ name: 'only-name' });
  });
});
