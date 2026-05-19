import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilesButton } from './ProfilesButton';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useUiStore } from '@/src/stores/ui.store';

const meta = (id: string, name = 'P', updatedAt = 1) => ({ id, name, createdAt: 1, updatedAt });

beforeEach(() => {
  useProfilesStore.getState()._reset();
  useUiStore.getState()._reset();
});

describe('ProfilesButton', () => {
  it('shows "Profiles" when no active', () => {
    render(<ProfilesButton />);
    expect(screen.getByRole('button', { name: /open profiles manager/i })).toHaveTextContent(/profiles/i);
  });

  it('shows active profile name', () => {
    useProfilesStore.setState({
      profiles: [meta('A1', 'Coding')],
      activeProfileId: 'A1',
      hydrated: true,
    });
    render(<ProfilesButton />);
    expect(screen.getByRole('button')).toHaveTextContent('Coding');
  });

  it('truncates name longer than 20 chars with ellipsis', () => {
    useProfilesStore.setState({
      profiles: [meta('A1', 'A'.repeat(40))],
      activeProfileId: 'A1',
      hydrated: true,
    });
    render(<ProfilesButton />);
    const txt = screen.getByRole('button').textContent ?? '';
    expect(txt).toMatch(/…|\.\.\./);
  });

  it('click opens modal via useUiStore', async () => {
    render(<ProfilesButton />);
    await userEvent.click(screen.getByRole('button'));
    expect(useUiStore.getState().profilesModalOpen).toBe(true);
  });
});
