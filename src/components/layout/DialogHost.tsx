import { useDialog } from '@/src/hooks/useDialog';
import { PromptDialog } from '@/src/components/ui/PromptDialog';
import { ConfirmDialog } from '@/src/components/ui/ConfirmDialog';

export function DialogHost() {
  const { current } = useDialog();
  if (!current) return null;

  if (current.kind === 'prompt') {
    return (
      <PromptDialog
        open
        title={current.title}
        label={current.label}
        defaultValue={current.defaultValue}
        placeholder={current.placeholder}
        required={current.required}
        onConfirm={(v) => current.resolve(v)}
        onCancel={current.cancel}
      />
    );
  }

  return (
    <ConfirmDialog
      open
      title={current.title}
      message={current.message}
      confirmLabel={current.confirmLabel}
      cancelLabel={current.cancelLabel}
      destructive={current.destructive}
      onConfirm={() => current.resolve(true)}
      onCancel={current.cancel}
    />
  );
}
