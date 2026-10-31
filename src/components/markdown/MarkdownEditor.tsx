import { useEffect, useRef, type CSSProperties } from 'react';
import { EDITOR_CONFIG } from '@/src/lib/markdown/elements';

type EditorElement = HTMLElement & { value: string };

export interface MarkdownEditorProps {
  value: string;
  /** Accessible name of the text area. */
  label: string;
  /** Called on blur with the edited text (the element's `change` event). */
  onCommit: (value: string) => void;
  view?: 'split' | 'write' | 'preview';
  className?: string;
  style?: CSSProperties;
}

/**
 * <mdlib-editor> (toolbar + live preview) for React. Requires the elements to be
 * defined first (useMarkdownElements). React 19 sets `value` as a property; the
 * element ignores a value equal to its own, so echoes of our own commits are no-ops.
 */
export function MarkdownEditor({ value, label, onCommit, view = 'split', className, style }: MarkdownEditorProps) {
  const ref = useRef<EditorElement>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => onCommitRef.current(el.value);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);

  return (
    <mdlib-editor
      ref={ref}
      value={value}
      label={label}
      plugins="gfm"
      config={EDITOR_CONFIG}
      view={view}
      className={className}
      style={style}
    />
  );
}
