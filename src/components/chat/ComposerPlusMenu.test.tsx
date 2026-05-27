import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Paperclip, Camera } from 'lucide-react';
import { ComposerPlusMenu, type ComposerAction } from './ComposerPlusMenu';

function actions(onFiles = vi.fn()): ComposerAction[] {
  return [{ id: 'files', label: 'Add files or photos', icon: Paperclip, onSelect: onFiles }];
}

describe('ComposerPlusMenu', () => {
  it('is closed initially; opens on trigger click and lists actions', async () => {
    render(<ComposerPlusMenu actions={actions()} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /add to message/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /add files or photos/i })).toBeInTheDocument();
  });

  it('runs the action and closes when an item is clicked', async () => {
    const onFiles = vi.fn();
    render(<ComposerPlusMenu actions={actions(onFiles)} />);
    await userEvent.click(screen.getByRole('button', { name: /add to message/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /add files or photos/i }));
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    render(<ComposerPlusMenu actions={actions()} />);
    await userEvent.click(screen.getByRole('button', { name: /add to message/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on outside pointer-down', async () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <ComposerPlusMenu actions={actions()} />
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: /add to message/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not open when the trigger is disabled', async () => {
    render(<ComposerPlusMenu actions={actions()} disabled />);
    const trigger = screen.getByRole('button', { name: /add to message/i });
    expect(trigger).toBeDisabled();
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders multiple actions in order (extensibility)', async () => {
    const acts: ComposerAction[] = [
      { id: 'files', label: 'Add files or photos', icon: Paperclip, onSelect: vi.fn() },
      { id: 'shot', label: 'Take a screenshot', icon: Camera, onSelect: vi.fn() },
    ];
    render(<ComposerPlusMenu actions={acts} />);
    await userEvent.click(screen.getByRole('button', { name: /add to message/i }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Add files or photos', 'Take a screenshot']);
  });
});
