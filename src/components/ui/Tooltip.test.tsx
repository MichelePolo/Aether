import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders the trigger child', () => {
    render(<Tooltip label="hint"><button>Action</button></Tooltip>);
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
  });

  it('attaches the label as title to the child wrapper', () => {
    render(<Tooltip label="hint"><button>Action</button></Tooltip>);
    expect(screen.getByTitle('hint')).toBeInTheDocument();
  });

  it('passes through ref-less children unchanged', () => {
    render(<Tooltip label="hint"><span data-testid="ch">x</span></Tooltip>);
    expect(screen.getByTestId('ch')).toHaveTextContent('x');
  });
});
