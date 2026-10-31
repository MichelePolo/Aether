import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkillsSection } from './SkillsSection';
import { useContextStore } from '@/src/stores/context.store';
import { useSkillsStore } from '@/src/stores/skills.store';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { _resetDialogStore } from '@/src/hooks/useDialog';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { ensureMarkdownElements } from '@/src/lib/markdown/elements';

beforeAll(() => ensureMarkdownElements());

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
    await user.click(screen.getByRole('button', { name: /rename alpha/i }));
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

describe('SkillsSection material skills (SKILL.md)', () => {
  const SKILL = '---\nname: alpha\ndescription: Writes **commits**\n---\n# Alpha';

  beforeEach(() => {
    useContextStore.setState((st) => ({ context: st.context ? { ...st.context, skills: [] } : null }));
    useSkillsStore.setState({
      skills: [{ name: 'alpha', enabled: true, pinned: false, description: 'Writes **commits**' }],
      drafts: [{ name: 'beta', description: 'A `draft`' }],
      paths: null,
      error: null,
    });
  });

  function renderWithHost() {
    return render(
      <>
        <SkillsSection />
        <DialogHost />
      </>,
    );
  }

  it('renders descriptions as Markdown', () => {
    renderWithHost();
    expect(screen.getByText('commits').tagName).toBe('STRONG');
    expect(screen.getByText('draft').tagName).toBe('CODE');
  });

  it('opens SKILL.md in a split-view editor and saves it', async () => {
    let saved: unknown = null;
    server.use(
      http.get('http://localhost/api/skills/alpha/content', () => HttpResponse.json({ content: SKILL })),
      http.put('http://localhost/api/skills/alpha/content', async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ status: 'ok' });
      }),
      http.get('http://localhost/api/skills', () => HttpResponse.json({ skills: [], drafts: [], paths: null })),
    );
    const user = userEvent.setup();
    renderWithHost();

    await user.click(screen.getByRole('button', { name: 'Edit alpha' }));
    const dialog = await screen.findByRole('dialog', { name: 'alpha · SKILL.md' });
    const editor = dialog.querySelector('mdlib-editor');
    expect(editor).toHaveAttribute('view', 'split');
    expect(editor).toHaveAttribute('plugins', 'gfm frontmatter');
    const ta = within(dialog).getByRole('textbox', { name: 'SKILL.md' });
    expect(ta).toHaveValue(SKILL);

    await user.type(ta, '\n\nMore.');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(saved).toEqual({ content: `${SKILL}\n\nMore.`, draft: false });
  });

  it('keeps the editor open with the server error when the save is rejected', async () => {
    server.use(
      http.get('http://localhost/api/skills/alpha/content', () => HttpResponse.json({ content: SKILL })),
      http.put('http://localhost/api/skills/alpha/content', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION', message: 'Frontmatter name "x" must match directory name "alpha"' } },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithHost();

    await user.click(screen.getByRole('button', { name: 'Edit alpha' }));
    const dialog = await screen.findByRole('dialog', { name: 'alpha · SKILL.md' });
    const ta = within(dialog).getByRole('textbox', { name: 'SKILL.md' });
    await user.type(ta, ' edited');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('must match directory name "alpha"');
    expect(ta).toHaveValue(`${SKILL} edited`);
  });

  it('opens drafts with draft=1', async () => {
    let url = '';
    server.use(
      http.get('http://localhost/api/skills/beta/content', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ content: '---\nname: beta\ndescription: d\n---' });
      }),
    );
    const user = userEvent.setup();
    renderWithHost();
    await user.click(screen.getByRole('button', { name: 'Edit draft beta' }));
    await screen.findByRole('dialog', { name: 'beta · SKILL.md' });
    expect(new URL(url).searchParams.get('draft')).toBe('1');
  });

  it('shows the error and opens nothing when SKILL.md cannot be read', async () => {
    server.use(
      http.get('http://localhost/api/skills/alpha/content', () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'skill alpha not found' } }, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    renderWithHost();
    await user.click(screen.getByRole('button', { name: 'Edit alpha' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('skill alpha not found');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

