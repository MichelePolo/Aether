import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkillsSection } from './SkillsSection';
import { useContextStore } from '@/src/stores/context.store';
import { useSkillsStore } from '@/src/stores/skills.store';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { _resetDialogStore } from '@/src/hooks/useDialog';

beforeEach(() => {
  _resetDialogStore();
  useSkillsStore.setState({ skills: [], drafts: [], paths: null, error: null });
  useContextStore.setState({
    context: {
      systemInstruction: '',
      skills: [
        { name: 'Alpha', enabled: true },
        { name: 'Beta', enabled: true },
      ],
      tools: [],
      mcpServers: [],
    },
    isLoading: false,
    error: null,
    addSkill: async (name: string) => {
      useContextStore.setState((s) => ({
        context: s.context
          ? { ...s.context, skills: [...s.context.skills, { name, enabled: true }] }
          : null,
      }));
    },
    updateSkillAt: async (i: number, v: string) => {
      useContextStore.setState((s) => {
        if (!s.context) return s;
        const skills = [...s.context.skills];
        skills[i] = { ...skills[i], name: v };
        return { context: { ...s.context, skills } };
      });
    },
    toggleSkillAt: async (_i: number) => {},
    removeSkillAt: async (i: number) => {
      useContextStore.setState((s) => ({
        context: s.context
          ? { ...s.context, skills: s.context.skills.filter((_, idx) => idx !== i) }
          : null,
      }));
    },
  } as never);
});

describe('SkillsSection', () => {
  it('lists skills', () => {
    render(<><DialogHost /><SkillsSection /></>);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows count badge as active/total', () => {
    render(<><DialogHost /><SkillsSection /></>);
    expect(screen.getByText('[2/2]')).toBeInTheDocument();
  });

  it('clicking add opens prompt dialog and adds new skill', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><SkillsSection /></>);
    await user.click(screen.getByRole('button', { name: /add skill/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), 'Gamma');
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.skills.map((s) => s.name)).toContain('Gamma');
  });

  it('removing a skill confirms then removes', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><SkillsSection /></>);
    await user.click(screen.getByRole('button', { name: /remove alpha/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.skills.map((s) => s.name)).toEqual(['Beta']);
  });

  it('cancel remove does not delete skill', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><SkillsSection /></>);
    await user.click(screen.getByRole('button', { name: /remove alpha/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(useContextStore.getState().context?.skills.map((s) => s.name)).toEqual(['Alpha', 'Beta']);
  });

  it('editing a skill prompts with default value and updates', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><SkillsSection /></>);
    await user.click(screen.getByRole('button', { name: /edit alpha/i }));
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('Alpha');
    await user.clear(input);
    await user.type(input, 'AlphaV2');
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.skills[0].name).toBe('AlphaV2');
  });

  it('shows a dismissible error pill when the skills store has an error', async () => {
    const user = userEvent.setup();
    useSkillsStore.setState({ error: 'Promote failed: EPERM' });
    render(<SkillsSection />);
    expect(screen.getByText(/Promote failed: EPERM/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /dismiss error/i }));
    expect(useSkillsStore.getState().error).toBeNull();
  });

  it('clicking a skill row toggles it and dims a disabled skill', async () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    useContextStore.setState({
      context: {
        systemInstruction: '',
        skills: [{ name: 'web-search', enabled: false }],
        tools: [],
        mcpServers: [],
      },
      toggleSkillAt: toggle,
    } as never);

    render(<SkillsSection />);
    const row = screen.getByText('web-search').closest('[data-skill-row]') as HTMLElement;
    expect(row.className).toMatch(/line-through|opacity/);
    await userEvent.click(row);
    expect(toggle).toHaveBeenCalledWith(0);
  });
});
