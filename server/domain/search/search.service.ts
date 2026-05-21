import type { DatabaseHandle } from '@/server/db/database';
import type { SessionHits, SnippetHit } from './search.types';

type RowShape = {
  messageId: string;
  sessionId: string;
  role: 'user' | 'model';
  snippet: string;
  rank: number;
  title: string;
  updatedAt: number;
};

interface SearchOpts {
  limit?: number;
  snippetsPerSession?: number;
}

const SQL = `
  SELECT
    mf.message_id AS messageId,
    mf.session_id AS sessionId,
    mf.role AS role,
    snippet(messages_fts, 3, '«M»', '«/M»', '…', 20) AS snippet,
    bm25(messages_fts) AS rank,
    s.title AS title,
    s.updated_at AS updatedAt
  FROM messages_fts mf
  JOIN sessions s ON s.id = mf.session_id
  WHERE messages_fts MATCH ?
  ORDER BY rank ASC, s.updated_at DESC
  LIMIT ?
`;

export class SearchService {
  constructor(private readonly db: DatabaseHandle) {}

  async search(query: string, opts: SearchOpts = {}): Promise<SessionHits[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const snippetsPerSession = Math.max(opts.snippetsPerSession ?? 3, 1);

    let rows: RowShape[];
    try {
      rows = this.db.prepare(SQL).all(trimmed, limit) as RowShape[];
    } catch {
      // FTS5 syntax error or any other prepare/run failure → empty results.
      return [];
    }

    const grouped = new Map<string, SessionHits>();
    for (const r of rows) {
      let entry = grouped.get(r.sessionId);
      if (!entry) {
        entry = {
          sessionId: r.sessionId,
          title: r.title,
          updatedAt: r.updatedAt,
          hits: [],
        };
        grouped.set(r.sessionId, entry);
      }
      if (entry.hits.length < snippetsPerSession) {
        const hit: SnippetHit = {
          messageId: r.messageId,
          role: r.role,
          snippet: r.snippet,
        };
        entry.hits.push(hit);
      }
    }

    // SQL ORDER BY already sorts rows by rank ASC; insertion order into the
    // Map preserves session ordering by best hit's rank.
    return Array.from(grouped.values());
  }
}
