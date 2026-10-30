import { createElement, memo, useDeferredValue, useMemo } from 'react';
import { toElements } from 'mdlib-pure/adapter';
import { chatMarkdown } from '@/src/lib/markdown/markdown';
import { cn } from '@/src/lib/cn';

export interface MarkdownViewProps {
  source: string;
  className?: string;
}

/**
 * Model output as real React elements (no innerHTML: raw HTML in the source
 * renders as text). Safe to use while a reply streams: partial Markdown follows
 * CommonMark (an unclosed fence runs to the end, an unclosed ** stays literal),
 * top-level blocks are keyed by position so finished blocks keep their DOM, and
 * the deferred value lets React skip intermediate chunks when it falls behind.
 */
export const MarkdownView = memo(function MarkdownView({ source, className }: MarkdownViewProps) {
  const deferred = useDeferredValue(source);
  const elements = useMemo(
    () => toElements(chatMarkdown.toVNodes(deferred), createElement, 'react'),
    [deferred],
  );
  return <div className={cn('md', className)}>{elements}</div>;
});
