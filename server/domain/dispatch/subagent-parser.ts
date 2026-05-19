const LEADING_MENTION = /^@([A-Za-z][A-Za-z0-9_-]*)(\s+|$)/;

export interface ParsedMention {
  name: string | null;
  stripped: string;
}

export function parseLeadingMention(
  message: string,
  knownNames: ReadonlySet<string>,
): ParsedMention {
  const m = message.match(LEADING_MENTION);
  if (!m) return { name: null, stripped: message };
  const name = m[1];
  if (!knownNames.has(name)) return { name: null, stripped: message };
  return { name, stripped: message.slice(m[0].length) };
}
