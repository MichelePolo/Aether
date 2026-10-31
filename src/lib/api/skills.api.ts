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

  /** Raw SKILL.md of a skill (or of a draft). */
  getContent: (slug: string, draft = false): Promise<string> =>
    fetch(`/api/skills/${encodeURIComponent(slug)}/content${draft ? '?draft=1' : ''}`)
      .then(jsonRes<{ content: string }>)
      .then((r) => r.content),

  /** Replace SKILL.md; the server rejects content that would make the skill invalid. */
  putContent: async (slug: string, content: string, draft = false): Promise<void> => {
    await fetch(`/api/skills/${encodeURIComponent(slug)}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, draft }),
    }).then(jsonRes);
  },

  remove: async (slug: string): Promise<void> => {
    const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.statusText);
  },
};
