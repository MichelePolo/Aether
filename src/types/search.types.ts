export interface SnippetHit {
  messageId: string;
  role: 'user' | 'model';
  snippet: string;
}

export interface SessionHits {
  sessionId: string;
  title: string;
  updatedAt: number;
  hits: SnippetHit[];
}
