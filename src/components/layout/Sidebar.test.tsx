import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders header brand + children + footer', () => {
    render(
      <Sidebar header={<div>HDR</div>} footer={<div>FOOT</div>}>
        <div>BODY</div>
      </Sidebar>,
    );
    expect(screen.getByText('HDR')).toBeInTheDocument();
    expect(screen.getByText('BODY')).toBeInTheDocument();
    expect(screen.getByText('FOOT')).toBeInTheDocument();
  });

  it('does not render footer slot when footer is undefined', () => {
    render(<Sidebar header={<div>HDR</div>}><div>BODY</div></Sidebar>);
    expect(screen.getByText('HDR')).toBeInTheDocument();
    expect(screen.getByText('BODY')).toBeInTheDocument();
  });
});
