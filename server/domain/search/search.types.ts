export interface SnippetHit {
  messageId: string;
  role: 'user' | 'model';
  snippet: string; // contains «M»…«/M» highlight markers
}

export interface SessionHits {
  sessionId: string;
  title: string;
  updatedAt: number;
  hits: SnippetHit[];
}
