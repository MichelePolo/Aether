export function hueFromName(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function colorFor(name: string): string {
  if (name === "(no branch ref)") return "hsl(215 10% 50%)";
  return `hsl(${hueFromName(name)} 68% 60%)`;
}
