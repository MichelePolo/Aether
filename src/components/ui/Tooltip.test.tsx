import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders the trigger child', () => {
    render(<Tooltip label="hint"><button>Action</button></Tooltip>);
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
  });

  it('shows tooltip content on focus', () => {
    render(
      <Tooltip label="Hello tooltip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const btn = screen.getByText('Trigger');
    fireEvent.focus(btn);
    expect(screen.getByText('Hello tooltip')).toBeInTheDocument();
  });

  it('hides on blur', () => {
    render(
      <Tooltip label="Bye tooltip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const btn = screen.getByText('Trigger');
    fireEvent.focus(btn);
    fireEvent.blur(btn);
    expect(screen.queryByText('Bye tooltip')).not.toBeInTheDocument();
  });

  it('shows on mouseenter and hides on Escape', () => {
    render(
      <Tooltip label="Mouse tooltip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const btn = screen.getByText('Trigger');
    fireEvent.mouseEnter(btn);
    expect(screen.getByText('Mouse tooltip')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Mouse tooltip')).not.toBeInTheDocument();
  });
});
