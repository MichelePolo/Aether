import type { SessionHits } from '@/src/types/search.types';

export interface SearchOpts {
  limit?: number;
  signal?: AbortSignal;
}

export const searchApi = {
  async search(q: string, opts: SearchOpts = {}): Promise<SessionHits[]> {
    const params = new URLSearchParams({ q });
    if (typeof opts.limit === 'number') {
      params.set('limit', String(opts.limit));
    }
    const res = await fetch(`/api/search?${params.toString()}`, {
      method: 'GET',
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { results: SessionHits[] };
    return body.results;
  },
};
