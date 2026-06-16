import type { SkillsList } from '@/server/domain/skills/skills.types';

async function jsonRes<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const skillsApi = {
  list: (): Promise<SkillsList> => fetch('/api/skills').then(jsonRes<SkillsList>),

  setEnabled: async (slug: string, enabled: boolean): Promise<void> => {
    await fetch(`/api/skills/${encodeURIComponent(slug)}/enabled`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).then(jsonRes);
  },

  setPinned: async (slug: string, pinned: boolean): Promise<void> => {
    await fetch(`/api/skills/${encodeURIComponent(slug)}/pinned`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned }),
    }).then(jsonRes);
  },

  promote: async (slug: string): Promise<void> => {
    await fetch('/api/skills/promote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    }).then(jsonRes);
  },

  remove: async (slug: string): Promise<void> => {
    const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.statusText);
  },
};
