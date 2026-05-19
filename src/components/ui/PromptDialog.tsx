import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title,
  label,
  defaultValue = '',
  placeholder,
  required = false,
  multiline = false,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTimeout(() => {
        (multiline ? textareaRef : inputRef).current?.focus();
      }, 10);
    }
  }, [open, defaultValue, multiline]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (required && !value.trim()) return;
    onConfirm(value);
  };

  const canConfirm = !required || value.trim().length > 0;
  const fieldClass =
    'mt-1 w-full bg-zinc-900 border border-border-subtle rounded px-2 py-1.5 text-sm text-white outline-none focus:border-accent';

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mono-label">{label}</span>
          {multiline ? (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              rows={8}
              className={`${fieldClass} font-mono text-xs resize-y min-h-[160px]`}
            />
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className={fieldClass}
            />
          )}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={!canConfirm}>Confirm</Button>
        </div>
      </form>
    </Modal>
  );
}
