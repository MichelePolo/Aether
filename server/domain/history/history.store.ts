import { randomUUID } from 'node:crypto';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import { computeTitle } from './title';
import type { Message, SessionMeta, SessionRecord } from './history.types';
import type { ReasoningStep, ToolCallTrace } from '@/server/domain/reasoning/reasoning.types';
import type { DatabaseHandle } from '@/server/db/database';

const TITLE_MAX = 200;

type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  provider_name: string | null;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: 'user' | 'model';
  content: string;
  model: string | null;
  interrupted: number;
  error: string | null;
  retryable: number | null;
  created_at: number;
  position: number;
};

type ReasoningRow = {
  id: string;
  message_id: string;
  type: string;
  title: string;
  content: string;
  tokens: number | null;
  duration_ms: number | null;
  sub_agent: string | null;
  timestamp: number;
  position: number;
};

type ToolCallRow = {
  id: string;
  reasoning_step_id: string;
  qualified_name: string;
  args: string;
  result: string | null;
  error: string | null;
  duration_ms: number;
  progress_note: string | null;
};

export class HistoryStore {
  constructor(private readonly db: DatabaseHandle) {}

  async listSessions(): Promise<SessionMeta[]> {
    const rows = this.db
      .prepare(
        'SELECT id, title, created_at, updated_at, provider_name FROM sessions ORDER BY updated_at DESC',
      )
      .all() as SessionRow[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      providerName: r.provider_name ?? undefined,
    }));
  }

  async read(sessionId: string): Promise<Message[] | null> {
    const session = this.db
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .get(sessionId) as { id: string } | undefined;
    if (!session) return null;
    return this.readMessages(sessionId);
  }

  async createEmpty(opts?: { providerName?: string }): Promise<SessionMeta> {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO sessions (id, title, created_at, updated_at, provider_name) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, '', now, now, opts?.providerName ?? null);
    return { id, title: '', createdAt: now, updatedAt: now, providerName: opts?.providerName };
  }

  async readRecord(id: string): Promise<SessionRecord | null> {
    const row = this.db
      .prepare(
        'SELECT id, title, created_at, updated_at, provider_name FROM sessions WHERE id = ?',
      )
      .get(id) as SessionRow | undefined;
    if (!row) return null;
    const messages = this.readMessages(id);
    return {
      title: row.title,
      createdAt: row.created_at,
      providerName: row.provider_name ?? undefined,
      messages,
    };
  }

  async setProviderName(id: string, providerName: string): Promise<void> {
    const info = this.db
      .prepare('UPDATE sessions SET provider_name = ? WHERE id = ?')
      .run(providerName, id);
    if (info.changes === 0) throw new NotFoundError(`session ${id}`);
  }

  async append(sessionId: string, message: Message): Promise<void> {
    const tx = this.db.transaction(() => {
      const session = this.db
        .prepare('SELECT title FROM sessions WHERE id = ?')
        .get(sessionId) as { title: string } | undefined;
      if (!session) throw new NotFoundError(`session ${sessionId}`);

      const position =
        (this.db
          .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM messages WHERE session_id = ?')
          .get(sessionId) as { p: number }).p;

      const isFirstUser = position === 0 && message.role === 'user' && session.title === '';
      const nextTitle = isFirstUser ? computeTitle(message.text) : session.title;

      this.db
        .prepare(
          'INSERT INTO messages (id, session_id, role, content, model, interrupted, error, retryable, created_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          message.id,
          sessionId,
          message.role,
          message.text,
          message.model ?? null,
          message.interrupted ? 1 : 0,
          message.error ?? null,
          message.retryable === undefined ? null : (message.retryable ? 1 : 0),
          message.timestamp,
          position,
        );

      this.insertReasoningSteps(message.id, message.reasoningSteps ?? []);

      this.db
        .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
        .run(nextTitle, message.timestamp, sessionId);
    });
    tx();
  }

  async rename(sessionId: string, title: string): Promise<SessionMeta> {
    if (!title.trim()) throw new ValidationError('Title cannot be empty');
    if (title.length > TITLE_MAX) throw new ValidationError(`Title too long (max ${TITLE_MAX})`);
    const info = this.db
      .prepare('UPDATE sessions SET title = ? WHERE id = ?')
      .run(title, sessionId);
    if (info.changes === 0) throw new NotFoundError(`session ${sessionId}`);
    const row = this.db
      .prepare(
        'SELECT id, title, created_at, updated_at, provider_name FROM sessions WHERE id = ?',
      )
      .get(sessionId) as SessionRow;
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      providerName: row.provider_name ?? undefined,
    };
  }

  async delete(sessionId: string): Promise<void> {
    const info = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    if (info.changes === 0) throw new NotFoundError(`session ${sessionId}`);
  }

  // ---- private helpers ----

  private readMessages(sessionId: string): Message[] {
    const msgRows = this.db
      .prepare(
        'SELECT id, session_id, role, content, model, interrupted, error, retryable, created_at, position FROM messages WHERE session_id = ? ORDER BY position',
      )
      .all(sessionId) as MessageRow[];

    return msgRows.map((m) => {
      const msg: Message = {
        id: m.id,
        role: m.role,
        text: m.content,
        timestamp: m.created_at,
      };
      if (m.model !== null) msg.model = m.model;
      if (m.interrupted === 1) msg.interrupted = true;
      if (m.error !== null) msg.error = m.error;
      if (m.retryable !== null) msg.retryable = m.retryable === 1;
      const steps = this.readReasoningSteps(m.id);
      if (steps.length > 0) msg.reasoningSteps = steps;
      return msg;
    });
  }

  private readReasoningSteps(messageId: string): ReasoningStep[] {
    const stepRows = this.db
      .prepare(
        'SELECT id, message_id, type, title, content, tokens, duration_ms, sub_agent, timestamp, position FROM reasoning_steps WHERE message_id = ? ORDER BY position',
      )
      .all(messageId) as ReasoningRow[];

    return stepRows.map((s) => {
      const step: ReasoningStep = {
        id: s.id,
        type: s.type as ReasoningStep['type'],
        title: s.title,
        content: s.content,
        timestamp: s.timestamp,
      };
      if (s.tokens !== null) step.tokens = s.tokens;
      if (s.duration_ms !== null) step.durationMs = s.duration_ms;
      if (s.sub_agent !== null) step.subAgent = s.sub_agent;
      if (s.type === 'tool_call') {
        const trace = this.readToolCallTrace(s.id);
        if (trace) step.toolCall = trace;
      }
      return step;
    });
  }

  private readToolCallTrace(reasoningStepId: string): ToolCallTrace | null {
    const row = this.db
      .prepare(
        'SELECT id, reasoning_step_id, qualified_name, args, result, error, duration_ms, progress_note FROM tool_call_traces WHERE reasoning_step_id = ?',
      )
      .get(reasoningStepId) as ToolCallRow | undefined;
    if (!row) return null;
    const trace: ToolCallTrace = {
      id: row.id,
      qualifiedName: row.qualified_name,
      args: JSON.parse(row.args) as Record<string, unknown>,
      durationMs: row.duration_ms,
    };
    if (row.result !== null) trace.result = JSON.parse(row.result);
    if (row.error !== null) trace.error = row.error;
    if (row.progress_note !== null) trace.progressNote = row.progress_note;
    return trace;
  }

  private insertReasoningSteps(messageId: string, steps: ReasoningStep[]): void {
    const insertStep = this.db.prepare(
      'INSERT INTO reasoning_steps (id, message_id, type, title, content, tokens, duration_ms, sub_agent, timestamp, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertTrace = this.db.prepare(
      'INSERT INTO tool_call_traces (id, reasoning_step_id, qualified_name, args, result, error, duration_ms, progress_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );

    steps.forEach((step, i) => {
      insertStep.run(
        step.id,
        messageId,
        step.type,
        step.title,
        step.content,
        step.tokens ?? null,
        step.durationMs ?? null,
        step.subAgent ?? null,
        step.timestamp,
        i,
      );
      if (step.type === 'tool_call' && step.toolCall) {
        const tc = step.toolCall;
        insertTrace.run(
          tc.id,
          step.id,
          tc.qualifiedName,
          JSON.stringify(tc.args),
          tc.result === undefined ? null : JSON.stringify(tc.result),
          tc.error ?? null,
          tc.durationMs,
          tc.progressNote ?? null,
        );
      }
    });
  }
}
