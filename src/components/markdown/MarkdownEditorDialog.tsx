import { useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from '@/src/components/ui/Modal';
import { Button } from '@/src/components/ui/Button';
import { useMarkdownElements } from '@/src/lib/markdown/elements';
import { MarkdownEditor, type EditorElement } from './MarkdownEditor';

export interface MarkdownEditorDialogProps {
  open: boolean;
  title: string;
  /** Accessible name of the text area. */
  label: string;
  defaultValue: string;
  /** mdlib-pure plugin names for the preview (default `gfm`). */
  plugins?: string;
  /** May return a promise: the dialog shows "Saving…", and an error keeps it open. */
  onSave: (value: string) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * A large centered modal with the Markdown editor side by side with its live
 * preview. Nothing is saved until Save (or Ctrl/Cmd+S); Cancel and Escape
 * discard. Backdrop clicks don't close it, so a stray click keeps the draft,
 * and a failed save shows its error without closing.
 */
export function MarkdownEditorDialog({
  open,
  title,
  label,
  defaultValue,
  plugins,
  onSave,
  onCancel,
}: MarkdownEditorDialogProps) {
  const editorReady = useMarkdownElements();
  const editorRef = useRef<EditorElement>(null);
  const [plain, setPlain] = useState(defaultValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      await onSave(editorReady ? (editorRef.current?.value ?? plain) : plain);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      dismissOnBackdrop={false}
      className="max-w-none w-[min(92vw,1400px)] h-[88vh] max-h-[88vh]"
      bodyClassName="p-0 flex-1 min-h-0 overflow-hidden flex flex-col"
    >
      <div className="flex-1 min-h-0 p-3" onKeyDown={onKeyDown}>
        {editorReady ? (
          <MarkdownEditor
            editorRef={editorRef}
            // `plain` = defaultValue, or what was typed in the fallback before the editor loaded.
            value={plain}
            label={label}
            plugins={plugins}
            view="split"
            className="aether-md-editor aether-md-editor--dialog"
            style={{ blockSize: '100%' }}
          />
        ) : (
          <textarea
            aria-label={label}
            className="w-full h-full bg-zinc-900/50 border border-border-subtle rounded p-3 text-sm font-mono text-zinc-300 outline-none focus:border-disclosure resize-none"
            value={plain}
            onChange={(e) => setPlain(e.target.value)}
          />
        )}
      </div>
      <div className="shrink-0 flex items-center justify-end gap-2 px-4 py-3 border-t border-border-subtle">
        {error ? (
          <span role="alert" className="mr-auto text-xs text-status-error">⚠ {error}</span>
        ) : (
          <span className="mr-auto text-[11px] text-zinc-500">Ctrl+S to save · Esc to discard</span>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
