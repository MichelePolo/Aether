import { vi } from 'vitest';
import type { MaterialSkill } from '@/server/domain/skills/skills.types';

vi.mock('@/src/lib/api/skills.api', () => ({
  skillsApi: {
    list: vi.fn(),
    setEnabled: vi.fn(),
    setPinned: vi.fn(),
    promote: vi.fn(),
    remove: vi.fn(),
  },
}));

import { skillsApi } from '@/src/lib/api/skills.api';
import { useSkillsStore } from './skills.store';

const m = (over: Partial<MaterialSkill>): MaterialSkill => ({
  name: 'alpha', enabled: false, pinned: false, description: 'd', invalid: undefined, ...over,
});

beforeEach(() => {
  useSkillsStore.setState({ skills: [], drafts: [], paths: null, isLoading: false, error: null });
  vi.clearAllMocks();
});

describe('useSkillsStore', () => {
  it('init loads skills + drafts', async () => {
    (skillsApi.list as any).mockResolvedValue({ skills: [m({})], drafts: [], paths: { skillsDir: '/d/skills', draftsDir: '/d/skills/.drafts' } });
    await useSkillsStore.getState().init();
    expect(useSkillsStore.getState().skills).toHaveLength(1);
  });

  it('toggleEnabled optimistically flips then calls API', async () => {
    useSkillsStore.setState({ skills: [m({ enabled: false })] });
    (skillsApi.setEnabled as any).mockResolvedValue(undefined);
    await useSkillsStore.getState().toggleEnabled('alpha');
    expect(useSkillsStore.getState().skills[0].enabled).toBe(true);
    expect(skillsApi.setEnabled).toHaveBeenCalledWith('alpha', true);
  });

  it('toggleEnabled rolls back on API error', async () => {
    useSkillsStore.setState({ skills: [m({ enabled: false })] });
    (skillsApi.setEnabled as any).mockRejectedValue(new Error('boom'));
    await expect(useSkillsStore.getState().toggleEnabled('alpha')).rejects.toThrow();
    expect(useSkillsStore.getState().skills[0].enabled).toBe(false);
  });

  it('togglePinned optimistically flips then calls API', async () => {
    useSkillsStore.setState({ skills: [m({ pinned: false })] });
    (skillsApi.setPinned as any).mockResolvedValue(undefined);
    await useSkillsStore.getState().togglePinned('alpha');
    expect(useSkillsStore.getState().skills[0].pinned).toBe(true);
  });

  it('promote calls API then refreshes', async () => {
    useSkillsStore.setState({ drafts: [{ name: 'wip', description: 'w', invalid: undefined }] });
    (skillsApi.promote as any).mockResolvedValue(undefined);
    (skillsApi.list as any).mockResolvedValue({ skills: [m({ name: 'wip' })], drafts: [], paths: { skillsDir: '/d/skills', draftsDir: '/d/skills/.drafts' } });
    await useSkillsStore.getState().promote('wip');
    expect(skillsApi.promote).toHaveBeenCalledWith('wip');
    expect(useSkillsStore.getState().skills.map((s) => s.name)).toContain('wip');
  });

  it('init records the error and clears loading on API failure', async () => {
    (skillsApi.list as any).mockRejectedValue(new Error('offline'));
    await useSkillsStore.getState().init();
    const s = useSkillsStore.getState();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBe('offline');
  });

  it('togglePinned rolls back on API error', async () => {
    useSkillsStore.setState({ skills: [m({ pinned: false })] });
    (skillsApi.setPinned as any).mockRejectedValue(new Error('boom'));
    await expect(useSkillsStore.getState().togglePinned('alpha')).rejects.toThrow();
    expect(useSkillsStore.getState().skills[0].pinned).toBe(false);
  });

  it('toggleEnabled is a no-op for an unknown slug', async () => {
    useSkillsStore.setState({ skills: [m({ name: 'alpha' })] });
    await useSkillsStore.getState().toggleEnabled('ghost');
    expect(skillsApi.setEnabled).not.toHaveBeenCalled();
  });

  it('promote records the error on API failure', async () => {
    (skillsApi.promote as any).mockRejectedValue(new Error('exists'));
    await expect(useSkillsStore.getState().promote('wip')).rejects.toThrow();
    expect(useSkillsStore.getState().error).toBe('exists');
  });

  it('remove optimistically drops the skill then calls API', async () => {
    useSkillsStore.setState({ skills: [m({ name: 'alpha' }), m({ name: 'beta' })] });
    (skillsApi.remove as any).mockResolvedValue(undefined);
    await useSkillsStore.getState().remove('alpha');
    expect(useSkillsStore.getState().skills.map((s) => s.name)).toEqual(['beta']);
    expect(skillsApi.remove).toHaveBeenCalledWith('alpha');
  });

  it('remove rolls back on API error', async () => {
    useSkillsStore.setState({ skills: [m({ name: 'alpha' })] });
    (skillsApi.remove as any).mockRejectedValue(new Error('boom'));
    await expect(useSkillsStore.getState().remove('alpha')).rejects.toThrow();
    expect(useSkillsStore.getState().skills.map((s) => s.name)).toEqual(['alpha']);
  });
});
