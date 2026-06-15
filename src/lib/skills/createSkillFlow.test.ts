import { vi } from 'vitest';

const create = vi.fn();
const setProviderName = vi.fn();
const setPendingComposerText = vi.fn();

vi.mock('@/src/stores/sessions.store', () => ({
  useSessionsStore: { getState: () => ({ create, setProviderName }) },
}));
vi.mock('@/src/stores/chat.store', () => ({
  useChatStore: { getState: () => ({ setPendingComposerText }) },
}));
vi.mock('@/src/stores/skills.store', () => ({
  useSkillsStore: { getState: () => ({ paths: { skillsDir: '/d/skills', draftsDir: '/d/skills/.drafts' } }) },
}));

import { createSkillFlow } from './createSkillFlow';

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: 'sess-1' });
  setProviderName.mockResolvedValue(undefined);
});

describe('createSkillFlow', () => {
  it('creates a session, sets the provider, and prefills the composer with @skill-smith and the drafts path', async () => {
    await createSkillFlow({ providerName: 'anthropic:claude-opus-4-8', idea: 'a PDF helper' });
    expect(create).toHaveBeenCalledOnce();
    expect(setProviderName).toHaveBeenCalledWith('sess-1', 'anthropic:claude-opus-4-8');
    const prefill = setPendingComposerText.mock.calls[0][0] as string;
    expect(prefill).toMatch(/^@skill-smith /);
    expect(prefill).toContain('/d/skills/.drafts');
    expect(prefill).toContain('a PDF helper');
  });

  it('omits the idea sentence when no idea is given', async () => {
    await createSkillFlow({ providerName: 'p', idea: '' });
    const prefill = setPendingComposerText.mock.calls[0][0] as string;
    expect(prefill.startsWith('@skill-smith ')).toBe(true);
  });
});
