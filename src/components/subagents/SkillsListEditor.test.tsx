import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkillsListEditor } from './SkillsListEditor';
import { DialogHost } from '@/src/components/layout/DialogHost';

describe('SkillsListEditor', () => {
  it('shows empty state when skills=[]', () => {
    render(<SkillsListEditor skills={[]} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/no skills/i)).toBeInTheDocument();
  });

  it('renders one row per skill', () => {
    render(
      <SkillsListEditor
        skills={['layout', 'color']}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText('layout')).toBeInTheDocument();
    expect(screen.getByText('color')).toBeInTheDocument();
  });

  it('+ Add opens prompt; on confirm calls onAdd with the typed name', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <>
        <DialogHost />
        <SkillsListEditor skills={[]} onAdd={onAdd} onRemove={() => {}} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /add skill/i }));
    const input = await screen.findByLabelText(/skill name/i);
    await user.type(input, 'new-skill');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onAdd).toHaveBeenCalledWith('new-skill');
  });

  it('× on a row calls onRemove with the index', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<SkillsListEditor skills={['a', 'b']} onAdd={() => {}} onRemove={onRemove} />);
    await user.hover(screen.getByText('a'));
    await user.click(screen.getAllByRole('button', { name: /remove skill/i })[0]);
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
