const MAX_LEN = 40;

export function computeTitle(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (!collapsed) return 'Nuova sessione';
  if (collapsed.length <= MAX_LEN) return collapsed;
  return collapsed.slice(0, MAX_LEN).trimEnd() + '…';
}
