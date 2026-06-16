export interface Frontmatter {
  name?: string;
  description?: string;
}

const FENCE = '---';

/**
 * Parse the leading YAML frontmatter of a Markdown document, restricted to the
 * `name` and `description` scalar keys. Intentionally tiny — no nested YAML, no
 * new dependency. Returns {} when there is no well-formed leading block.
 */
export function parseFrontmatter(md: string): Frontmatter {
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) return {};
  const end = lines.indexOf(FENCE, 1);
  if (end === -1) return {};

  const out: Frontmatter = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    if (key !== 'name' && key !== 'description') continue;
    const value = unquote(line.slice(sep + 1).trim());
    if (value) out[key] = value;
  }
  return out;
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}
