import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders sidebar and main when open', () => {
    render(
      <AppShell sidebarOpen sidebar={<div>SIDE</div>}>
        <div>MAIN</div>
      </AppShell>,
    );
    expect(screen.getByText('SIDE')).toBeInTheDocument();
    expect(screen.getByText('MAIN')).toBeInTheDocument();
  });

  it('omits sidebar when closed', () => {
    render(
      <AppShell sidebarOpen={false} sidebar={<div>SIDE</div>}>
        <div>MAIN</div>
      </AppShell>,
    );
    expect(screen.queryByText('SIDE')).not.toBeInTheDocument();
    expect(screen.getByText('MAIN')).toBeInTheDocument();
  });

  it('renders main region with landmark role', () => {
    render(
      <AppShell sidebarOpen sidebar={<div />}>
        <div>main content</div>
      </AppShell>,
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
