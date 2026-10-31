import { Pencil } from 'lucide-react';
import { useContextStore } from '@/src/stores/context.store';
import { useDialog } from '@/src/hooks/useDialog';
import { IconButton } from '@/src/components/ui/IconButton';
import { MarkdownView } from '@/src/components/markdown/MarkdownView';

const LABEL = 'System instruction';

/** Rendered system instruction; the pencil opens the Markdown editor in a modal. */
export function SystemProtocolSection() {
  const systemInstruction = useContextStore((s) => s.context?.systemInstruction ?? '');
  const setSystemInstruction = useContextStore((s) => s.setSystemInstruction);
  const dialog = useDialog();

  const edit = () =>
    dialog.editMarkdown({
      title: LABEL,
      label: LABEL,
      defaultValue: systemInstruction,
      save: (value) => (value === systemInstruction ? undefined : setSystemInstruction(value)),
    });

  return (
    <section aria-label={LABEL}>
      <div className="flex justify-end">
        <IconButton label="Edit system instruction" onClick={() => void edit()}>
          <Pencil size={12} aria-hidden="true" />
        </IconButton>
      </div>
      {systemInstruction.trim() ? (
        <MarkdownView source={systemInstruction} className="aether-sidebar-md max-h-72 overflow-y-auto pr-1" />
      ) : (
        <p className="text-xs italic text-zinc-500">No system instruction yet.</p>
      )}
    </section>
  );
}
