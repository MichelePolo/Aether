import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkillsSection } from './SkillsSection';
import { useContextStore } from '@/src/stores/context.store';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { _resetDialogStore } from '@/src/hooks/useDialog';

beforeEach(() => {
  _resetDialogStore();
  useContextStore.setState({
    context: { systemInstruction: '', skills: ['Alpha', 'Beta'], tools: [], mcpServers: [] },
    isLoading: false,
    error: null,
    addSkill: async (name: string) => {
      useContextStore.setState((s) => ({
        context: s.context ? { ...s.context, skills: [...s.context.skills, name] } : null,
      }));
    },
    updateSkillAt: async (i: number, v: string) => {
      useContextStore.setState((s) => {
        if (!s.context) return s;
        const skills = [...s.context.skills];
        skills[i] = v;
        return { context: { ...s.context, skills } };
      });
    },
    removeSkillAt: async (i: number) => {
      useContextStore.setState((s) => ({
        context: s.context
          ? { ...s.context, skills: s.context.skills.filter((_, idx) => idx !== i) }
          : null,
      }));
    },
  });
});

describe('SkillsSection', () => {
  it('lists skills', () => {
    render(<><DialogHost /><SkillsSection /></>);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows count badge', () => {
    render(<><DialogHost /><SkillsSection /></>);
    expect(screen.getByText('[2]')).toBeInTheDocument();
  });

  it('clicking add opens prompt dialog and adds new skill', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><SkillsSection /></>);
    await user.click(screen.getByRole('button', { name: /add skill/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), 'Gamma');
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.skills).toContain('Gamma');
  });

  it('removing a skill confirms then removes', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><SkillsSection /></>);
    await user.click(screen.getByRole('button', { name: /remove alpha/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.skills).toEqual(['Beta']);
  });

  it('cancel remove does not delete skill', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><SkillsSection /></>);
    await user.click(screen.getByRole('button', { name: /remove alpha/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(useContextStore.getState().context?.skills).toEqual(['Alpha', 'Beta']);
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
    expect(useContextStore.getState().context?.skills[0]).toBe('AlphaV2');
  });
});
