import fs from 'node:fs';
import path from 'node:path';

// Pull the --color-fg-* values straight from the theme so this guards the real CSS.
function readFgTokens(): Record<string, string> {
  const css = fs.readFileSync(path.resolve(__dirname, 'theme.css'), 'utf8');
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--color-(fg-[a-z]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = c.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fg: string, bg: string): number {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('text tokens meet WCAG AA on the dark surfaces', () => {
  const tokens = readFgTokens();
  it('defines all four fg tiers', () => {
    expect(Object.keys(tokens).sort()).toEqual(['fg-base', 'fg-dim', 'fg-faint', 'fg-strong']);
  });
  for (const bg of ['#09090B', '#18181B']) {
    it(`each fg token is >= 4.5:1 on ${bg}`, () => {
      for (const [name, hex] of Object.entries(tokens)) {
        expect(ratio(hex, bg), `${name} (${hex}) on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
