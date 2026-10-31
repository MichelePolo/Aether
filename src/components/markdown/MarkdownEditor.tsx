import type { CSSProperties, RefObject } from 'react';
import { EDITOR_CONFIG } from '@/src/lib/markdown/elements';

export type EditorElement = HTMLElement & { value: string };

export interface MarkdownEditorProps {
  value: string;
  /** Accessible name of the text area. */
  label: string;
  view?: 'split' | 'write' | 'preview';
  /** mdlib-pure plugin names, space-separated (default `gfm`). */
  plugins?: string;
  /** Access to the element, to read `value` on an explicit Save. */
  editorRef?: RefObject<EditorElement | null>;
  className?: string;
  style?: CSSProperties;
}

/**
 * <mdlib-editor> (toolbar + live preview) for React. Requires the elements to be
 * defined first (useMarkdownElements). React 19 sets `value` as a property; the
 * element ignores a value equal to its own.
 */
export function MarkdownEditor({
  value,
  label,
  view = 'split',
  plugins = 'gfm',
  editorRef,
  className,
  style,
}: MarkdownEditorProps) {
  return (
    <mdlib-editor
      ref={editorRef}
      value={value}
      label={label}
      plugins={plugins}
      config={EDITOR_CONFIG}
      view={view}
      className={className}
      style={style}
    />
  );
}
