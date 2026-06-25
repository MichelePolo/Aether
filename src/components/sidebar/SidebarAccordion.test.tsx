import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Wrench } from 'lucide-react';
import { SidebarAccordion } from './SidebarAccordion';

function setup(open: boolean) {
  const onToggle = vi.fn();
  render(
    <SidebarAccordion
      icon={Wrench}
      title="Tools"
      open={open}
      onToggle={onToggle}
      actions={<button type="button">act</button>}
    >
      <div>body-content</div>
    </SidebarAccordion>,
  );
  return { onToggle };
}

describe('SidebarAccordion', () => {
  it('mounts the body only when open', () => {
    const { rerender } = render(
      <SidebarAccordion icon={Wrench} title="Tools" open={false} onToggle={() => {}}>
        <div>body-content</div>
      </SidebarAccordion>,
    );
    expect(screen.queryByText('body-content')).not.toBeInTheDocument();
    rerender(
      <SidebarAccordion icon={Wrench} title="Tools" open={true} onToggle={() => {}}>
        <div>body-content</div>
      </SidebarAccordion>,
    );
    expect(screen.getByText('body-content')).toBeInTheDocument();
  });

  it('clicking the title button calls onToggle', async () => {
    const { onToggle } = setup(false);
    await userEvent.click(screen.getByRole('button', { name: /tools/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('clicking the chevron calls onToggle', async () => {
    const { onToggle } = setup(true);
    await userEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('clicking an action does NOT toggle', async () => {
    const { onToggle } = setup(true);
    await userEvent.click(screen.getByRole('button', { name: 'act' }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('reflects open state via aria-expanded on the title button', () => {
    setup(true);
    expect(screen.getByRole('button', { name: /tools/i })).toHaveAttribute('aria-expanded', 'true');
  });
});
