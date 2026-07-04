import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
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
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const errId = useId();

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTouched(false);
      setTimeout(() => {
        (multiline ? textareaRef : inputRef).current?.focus();
      }, 10);
    }
  }, [open, defaultValue, multiline]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (required && !value.trim()) return;
    onConfirm(value);
  };

  const canConfirm = !required || value.trim().length > 0;
  const showError = required && touched && value.trim() === '';
  const fieldClass =
    'mt-1 w-full bg-zinc-900 border border-border-subtle rounded px-2 py-1.5 text-sm text-white outline-none focus:border-manipulation aria-[invalid=true]:border-status-error';

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <div className="flex items-baseline gap-1">
            <label htmlFor={fieldId} className="mono-label block">
              {label}
            </label>
            {required && (
              <span aria-hidden="true" className="text-status-error">
                *
              </span>
            )}
          </div>
          {multiline ? (
            <textarea
              id={fieldId}
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={placeholder}
              rows={8}
              required={required}
              aria-invalid={showError}
              aria-describedby={showError ? errId : undefined}
              className={`${fieldClass} font-mono text-xs resize-y min-h-[160px]`}
            />
          ) : (
            <input
              id={fieldId}
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={placeholder}
              required={required}
              aria-invalid={showError}
              aria-describedby={showError ? errId : undefined}
              className={fieldClass}
            />
          )}
          {showError && (
            <span id={errId} className="mt-1 block text-xs text-status-error">
              Required
            </span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={!canConfirm}>Confirm</Button>
        </div>
      </form>
    </Modal>
  );
}
