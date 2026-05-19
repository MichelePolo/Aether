import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilesTable } from './ProfilesTable';

const p = (id: string, name = 'P', updatedAt = 1) => ({ id, name, createdAt: 1, updatedAt });

const noop = () => {};

describe('ProfilesTable', () => {
  it('shows empty state when no profiles', () => {
    render(
      <ProfilesTable
        profiles={[]}
        activeId={null}
        onApply={noop}
        onSaveHere={noop}
        onRename={noop}
        onExport={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText(/no profiles yet/i)).toBeInTheDocument();
  });

  it('renders one row per profile', () => {
    render(
      <ProfilesTable
        profiles={[p('A', 'Alpha'), p('B', 'Beta')]}
        activeId={null}
        onApply={noop}
        onSaveHere={noop}
        onRename={noop}
        onExport={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('marks active row with aria-current', () => {
    render(
      <ProfilesTable
        profiles={[p('A'), p('B')]}
        activeId="B"
        onApply={noop}
        onSaveHere={noop}
        onRename={noop}
        onExport={noop}
        onDelete={noop}
      />,
    );
    const rows = screen.getAllByRole('row').filter((r) => r.getAttribute('aria-current') === 'true');
    expect(rows).toHaveLength(1);
  });

  it('Apply button calls onApply with id', async () => {
    const onApply = vi.fn();
    render(
      <ProfilesTable
        profiles={[p('A', 'Alpha')]}
        activeId={null}
        onApply={onApply}
        onSaveHere={noop}
        onRename={noop}
        onExport={noop}
        onDelete={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(onApply).toHaveBeenCalledWith('A');
  });

  it('Save here button calls onSaveHere with id', async () => {
    const onSaveHere = vi.fn();
    render(
      <ProfilesTable
        profiles={[p('A', 'Alpha')]}
        activeId={null}
        onApply={noop}
        onSaveHere={onSaveHere}
        onRename={noop}
        onExport={noop}
        onDelete={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /save here/i }));
    expect(onSaveHere).toHaveBeenCalledWith('A');
  });

  it('Rename button calls onRename with id and name', async () => {
    const onRename = vi.fn();
    render(
      <ProfilesTable
        profiles={[p('A', 'Alpha')]}
        activeId={null}
        onApply={noop}
        onSaveHere={noop}
        onRename={onRename}
        onExport={noop}
        onDelete={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /rename/i }));
    expect(onRename).toHaveBeenCalledWith('A', 'Alpha');
  });

  it('Export button calls onExport with id', async () => {
    const onExport = vi.fn();
    render(
      <ProfilesTable
        profiles={[p('A')]}
        activeId={null}
        onApply={noop}
        onSaveHere={noop}
        onRename={noop}
        onExport={onExport}
        onDelete={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(onExport).toHaveBeenCalledWith('A');
  });

  it('Delete button calls onDelete with id and name', async () => {
    const onDelete = vi.fn();
    render(
      <ProfilesTable
        profiles={[p('A', 'Alpha')]}
        activeId={null}
        onApply={noop}
        onSaveHere={noop}
        onRename={noop}
        onExport={noop}
        onDelete={onDelete}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith('A', 'Alpha');
  });
});
