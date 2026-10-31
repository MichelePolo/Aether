import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownEditorDialog } from './MarkdownEditorDialog';

// The editor element never becomes available (still loading, or the chunk failed).
vi.mock('@/src/lib/markdown/elements', () => ({
  EDITOR_CONFIG: 'aether',
  useMarkdownElements: () => false,
}));

it('falls back to a plain textarea and saves what was typed', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(
    <MarkdownEditorDialog open title="Notes" label="Notes" defaultValue="Hi" onSave={onSave} onCancel={() => {}} />,
  );
  const dialog = screen.getByRole('dialog', { name: 'Notes' });
  expect(dialog.querySelector('mdlib-editor')).toBeNull();
  const ta = within(dialog).getByRole('textbox', { name: 'Notes' });
  await user.type(ta, ' there');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledWith('Hi there');
});
