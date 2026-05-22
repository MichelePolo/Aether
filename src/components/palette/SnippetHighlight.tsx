import { Fragment } from 'react';

const MARK_OPEN = '«M»';
const MARK_CLOSE = '«/M»';

interface SnippetHighlightProps {
  snippet: string;
  className?: string;
}

export function SnippetHighlight({ snippet, className }: SnippetHighlightProps) {
  const parts: Array<{ text: string; mark: boolean }> = [];
  let i = 0;
  while (i < snippet.length) {
    const openIdx = snippet.indexOf(MARK_OPEN, i);
    if (openIdx === -1) {
      parts.push({ text: snippet.slice(i), mark: false });
      break;
    }
    if (openIdx > i) {
      parts.push({ text: snippet.slice(i, openIdx), mark: false });
    }
    const closeIdx = snippet.indexOf(MARK_CLOSE, openIdx + MARK_OPEN.length);
    if (closeIdx === -1) {
      parts.push({ text: snippet.slice(openIdx), mark: false });
      break;
    }
    parts.push({
      text: snippet.slice(openIdx + MARK_OPEN.length, closeIdx),
      mark: true,
    });
    i = closeIdx + MARK_CLOSE.length;
  }

  return (
    <span className={className}>
      {parts.map((p, idx) => (
        <Fragment key={idx}>
          {p.mark ? <mark className="bg-accent/30 text-white rounded-sm px-0.5">{p.text}</mark> : p.text}
        </Fragment>
      ))}
    </span>
  );
}
