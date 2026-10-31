import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemProtocolSection } from './SystemProtocolSection';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { useContextStore } from '@/src/stores/context.store';
import { _resetDialogStore } from '@/src/hooks/useDialog';
import { ensureMarkdownElements } from '@/src/lib/markdown/elements';

beforeAll(() => ensureMarkdownElements());

beforeEach(() => {
  _resetDialogStore();
  useContextStore.setState({
    context: { systemInstruction: '# Rules\n\nBe **brief**.', skills: [], tools: [], mcpServers: [] },
    isLoading: false,
    error: null,
  });
});

function renderWithHost() {
  return render(
    <>
      <SystemProtocolSection />
      <DialogHost />
    </>,
  );
}

describe('SystemProtocolSection', () => {
  it('shows the system instruction as rendered Markdown, with no editor in the sidebar', () => {
    const { container } = renderWithHost();
    const section = screen.getByRole('region', { name: 'System instruction' });
    expect(within(section).getByRole('heading', { name: 'Rules' })).toBeInTheDocument();
    expect(within(section).getByText('brief').tagName).toBe('STRONG');
    expect(container.querySelector('textarea, mdlib-editor')).toBeNull();
  });

  it('shows a placeholder when there is no instruction', () => {
    useContextStore.setState((s) => ({ context: s.context ? { ...s.context, systemInstruction: '  ' } : null }));
    renderWithHost();
    expect(screen.getByText(/no system instruction yet/i)).toBeInTheDocument();
  });

  it('edits in a split-view modal and saves on Save', async () => {
    const user = userEvent.setup();
    const setSystemInstruction = vi.fn(async () => {});
    useContextStore.setState({ setSystemInstruction });
    renderWithHost();

    await user.click(screen.getByRole('button', { name: 'Edit system instruction' }));
    const dialog = await screen.findByRole('dialog', { name: 'System instruction' });
    expect(dialog.querySelector('mdlib-editor')).toHaveAttribute('view', 'split');
    const ta = within(dialog).getByLabelText('System instruction');
    expect(ta).toHaveValue('# Rules\n\nBe **brief**.');

    await user.clear(ta);
    await user.type(ta, 'New rules');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(setSystemInstruction).toHaveBeenCalledWith('New rules');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('discards the draft on Cancel', async () => {
    const user = userEvent.setup();
    const setSystemInstruction = vi.fn(async () => {});
    useContextStore.setState({ setSystemInstruction });
    renderWithHost();

    await user.click(screen.getByRole('button', { name: 'Edit system instruction' }));
    const dialog = await screen.findByRole('dialog', { name: 'System instruction' });
    await user.type(within(dialog).getByLabelText('System instruction'), ' more');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(setSystemInstruction).not.toHaveBeenCalled();
  });

  it('does not save when the text is unchanged', async () => {
    const user = userEvent.setup();
    const setSystemInstruction = vi.fn(async () => {});
    useContextStore.setState({ setSystemInstruction });
    renderWithHost();

    await user.click(screen.getByRole('button', { name: 'Edit system instruction' }));
    const dialog = await screen.findByRole('dialog', { name: 'System instruction' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(setSystemInstruction).not.toHaveBeenCalled();
  });
});
