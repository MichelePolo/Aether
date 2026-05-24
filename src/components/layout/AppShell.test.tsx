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

  it('hides sidebar when closed (kept mounted so scroll state persists)', () => {
    render(
      <AppShell sidebarOpen={false} sidebar={<div>SIDE</div>}>
        <div>MAIN</div>
      </AppShell>,
    );
    // Sidebar element is still in the DOM but its <aside> wrapper carries `hidden`.
    expect(screen.getByText('SIDE')).toBeInTheDocument();
    const aside = screen.getByLabelText('Sidebar');
    expect(aside.className).toContain('hidden');
    expect(screen.getByText('MAIN')).toBeInTheDocument();
  });

  it('renders main region with main landmark', () => {
    render(
      <AppShell sidebarOpen sidebar={<div />}>
        <div>main content</div>
      </AppShell>,
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
