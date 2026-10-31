import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownEditorDialog } from './MarkdownEditorDialog';
import { ensureMarkdownElements } from '@/src/lib/markdown/elements';

beforeAll(() => ensureMarkdownElements());

function renderDialog(props: Partial<Parameters<typeof MarkdownEditorDialog>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <MarkdownEditorDialog
      open
      title="Notes"
      label="Notes"
      defaultValue="# Draft"
      onSave={onSave}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onSave: props.onSave ?? onSave, onCancel: props.onCancel ?? onCancel, dialog: screen.getByRole('dialog', { name: 'Notes' }) };
}

describe('MarkdownEditorDialog', () => {
  it('is a large centered modal with the editor in split view', () => {
    const { dialog } = renderDialog({ plugins: 'gfm frontmatter' });
    expect(dialog).toHaveClass('m-auto', 'h-[88vh]', 'w-[min(92vw,1400px)]');
    const editor = dialog.querySelector('mdlib-editor');
    expect(editor).toHaveAttribute('view', 'split');
    expect(editor).toHaveAttribute('plugins', 'gfm frontmatter');
    expect(within(dialog).getByRole('textbox', { name: 'Notes' })).toHaveValue('# Draft');
  });

  it('saves with Ctrl+S', async () => {
    const user = userEvent.setup();
    const { onSave, dialog } = renderDialog();
    const ta = within(dialog).getByRole('textbox', { name: 'Notes' });
    await user.type(ta, ' more');
    await user.keyboard('{Control>}s{/Control}');
    expect(onSave).toHaveBeenCalledWith('# Draft more');
  });

  it('shows "Saving…" while an async save runs and the error if it fails, keeping the draft', async () => {
    const user = userEvent.setup();
    let reject!: (e: Error) => void;
    const onSave = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    const { dialog } = renderDialog({ onSave });
    const ta = within(dialog).getByRole('textbox', { name: 'Notes' });
    await user.type(ta, '!');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();

    reject(new Error('disk full'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('disk full');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(ta).toHaveValue('# Draft!');
  });

  it('Cancel discards', async () => {
    const user = userEvent.setup();
    const { onSave, onCancel, dialog } = renderDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
