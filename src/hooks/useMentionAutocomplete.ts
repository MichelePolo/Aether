export interface MentionState {
  open: boolean;
  query: string;
  replaceRange: [number, number];
}

const CLOSED: MentionState = { open: false, query: '', replaceRange: [0, 0] };

export function computeMentionState(text: string, caret: number): MentionState {
  if (caret <= 0 || caret > text.length) return CLOSED;
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') {
      const before = i === 0 ? null : text[i - 1];
      if (before !== null && !/\s/.test(before)) return CLOSED;
      const query = text.slice(i + 1, caret);
      if (query.length > 0 && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(query)) return CLOSED;
      return { open: true, query, replaceRange: [i, caret] };
    }
    if (!/[A-Za-z0-9_-]/.test(ch)) return CLOSED;
    i--;
  }
  return CLOSED;
}
