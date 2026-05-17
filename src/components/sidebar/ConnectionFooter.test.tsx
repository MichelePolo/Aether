import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionFooter } from './ConnectionFooter';

describe('ConnectionFooter', () => {
  it('shows online status indicator', () => {
    render(<ConnectionFooter />);
    expect(screen.getByText('ONLINE')).toBeInTheDocument();
    expect(screen.getByTitle('Server: online')).toBeInTheDocument();
  });
});
