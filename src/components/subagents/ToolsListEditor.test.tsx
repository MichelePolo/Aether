import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolsListEditor } from './ToolsListEditor';
import { DialogHost } from '@/src/components/layout/DialogHost';
import type { Tool } from '@/src/types/context.types';

const sample: Tool[] = [
  { id: 't1', name: 'figma', version: '1.0.0', status: 'online' },
  { id: 't2', name: 'photoshop', version: '2.4', status: 'offline' },
];

describe('ToolsListEditor', () => {
  it('shows empty state when tools=[]', () => {
    render(<ToolsListEditor tools={[]} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/no tools/i)).toBeInTheDocument();
  });

  it('renders one row per tool with name + version', () => {
    render(<ToolsListEditor tools={sample} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByText('figma')).toBeInTheDocument();
    expect(screen.getByText(/1\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText('photoshop')).toBeInTheDocument();
  });

  it('+ Add runs the 3-step flow → calls onAdd with a tool having a fresh id', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <>
        <DialogHost />
        <ToolsListEditor tools={[]} onAdd={onAdd} onRemove={() => {}} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /add tool/i }));
    const nameInput = await screen.findByLabelText(/^name$/i);
    await user.type(nameInput, 'figma');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    const versionInput = await screen.findByLabelText(/version/i);
    await user.clear(versionInput);
    await user.type(versionInput, '2.0.0');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await user.click(screen.getByRole('button', { name: /online/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const tool = onAdd.mock.calls[0][0] as Tool;
    expect(tool.name).toBe('figma');
    expect(tool.version).toBe('2.0.0');
    expect(tool.status).toBe('online');
    expect(typeof tool.id).toBe('string');
    expect(tool.id.length).toBeGreaterThan(0);
  });

  it('× on a row calls onRemove with the tool id', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<ToolsListEditor tools={sample} onAdd={() => {}} onRemove={onRemove} />);
    await user.hover(screen.getByText('figma'));
    await user.click(screen.getAllByRole('button', { name: /remove tool/i })[0]);
    expect(onRemove).toHaveBeenCalledWith('t1');
  });
});
