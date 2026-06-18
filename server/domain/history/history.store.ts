import { randomUUID } from 'node:crypto';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import { computeTitle } from './title';
import type { Message, MessageAttachment, SessionMeta, SessionRecord } from './history.types';
import type { ReasoningStep, ToolCallTrace } from '@/server/domain/reasoning/reasoning.types';
import type { DatabaseHandle } from '@/server/db/database';
import { wrap, type ExportEnvelope } from './history.export';

const TITLE_MAX = 200;

type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  provider_name: string | null;
  workspace_id: string | null;
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
  tokens_in: number | null;
  tokens_out: number | null;
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
        'SELECT id, title, created_at, updated_at, provider_name, workspace_id FROM sessions ORDER BY updated_at DESC',
      )
      .all() as SessionRow[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      providerName: r.provider_name ?? undefined,
      workspaceId: r.workspace_id ?? undefined,
    }));
  }

  async read(sessionId: string): Promise<Message[] | null> {
    const session = this.db
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .get(sessionId) as { id: string } | undefined;
    if (!session) return null;
    return this.readMessages(sessionId);
  }

  async createEmpty(opts?: { providerName?: string; workspaceId?: string }): Promise<SessionMeta> {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO sessions (id, title, created_at, updated_at, provider_name, workspace_id) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, '', now, now, opts?.providerName ?? null, opts?.workspaceId ?? null);
    return {
      id,
      title: '',
      createdAt: now,
      updatedAt: now,
      providerName: opts?.providerName,
      workspaceId: opts?.workspaceId,
    };
  }

  async readRecord(id: string): Promise<SessionRecord | null> {
    const row = this.db
      .prepare(
        'SELECT id, title, created_at, updated_at, provider_name, workspace_id FROM sessions WHERE id = ?',
      )
      .get(id) as SessionRow | undefined;
    if (!row) return null;
    const messages = this.readMessages(id);
    return {
      title: row.title,
      createdAt: row.created_at,
      providerName: row.provider_name ?? undefined,
      workspaceId: row.workspace_id ?? undefined,
      messages,
    };
  }

  async exportSession(id: string): Promise<ExportEnvelope | null> {
    const record = await this.readRecord(id);
    if (!record) return null;
    return wrap(record, Date.now());
  }

  async setProviderName(id: string, providerName: string): Promise<void> {
    const info = this.db
      .prepare('UPDATE sessions SET provider_name = ? WHERE id = ?')
      .run(providerName, id);
    if (info.changes === 0) throw new NotFoundError(`session ${id}`);
  }

  async setSessionWorkspace(id: string, workspaceId: string | null): Promise<void> {
    this.db
      .prepare('UPDATE sessions SET workspace_id = ? WHERE id = ?')
      .run(workspaceId, id);
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
          'INSERT INTO messages (id, session_id, role, content, model, interrupted, error, retryable, created_at, position, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
          message.tokensIn ?? null,
          message.tokensOut ?? null,
        );

      this.db
        .prepare(
          'INSERT INTO messages_fts (message_id, session_id, role, content) VALUES (?, ?, ?, ?)',
        )
        .run(message.id, sessionId, message.role, message.text);

      this.insertReasoningSteps(message.id, message.reasoningSteps ?? []);

      if (message.attachments && message.attachments.length > 0) {
        this.insertAttachments(message.id, message.attachments);
      }

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
        'SELECT id, title, created_at, updated_at, provider_name, workspace_id FROM sessions WHERE id = ?',
      )
      .get(sessionId) as SessionRow;
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      providerName: row.provider_name ?? undefined,
      workspaceId: row.workspace_id ?? undefined,
    };
  }

  async delete(sessionId: string): Promise<void> {
    let deleted = false;
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages_fts WHERE session_id = ?').run(sessionId);
      const info = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      deleted = info.changes > 0;
    });
    tx();
    if (!deleted) throw new NotFoundError(`session ${sessionId}`);
  }

  async importSession(envelope: ExportEnvelope): Promise<SessionMeta> {
    const { session } = envelope;
    const newSessionId = randomUUID();
    const now = Date.now();

    const insertMessage = this.db.prepare(
      'INSERT INTO messages (id, session_id, role, content, model, interrupted, error, retryable, created_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertFts = this.db.prepare(
      'INSERT INTO messages_fts (message_id, session_id, role, content) VALUES (?, ?, ?, ?)',
    );

    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO sessions (id, title, created_at, updated_at, provider_name) VALUES (?, ?, ?, ?, ?)')
        .run(newSessionId, session.title, now, now, session.providerName ?? null);

      session.messages.forEach((msg, i) => {
        const newMsgId = randomUUID();
        insertMessage.run(
          newMsgId, newSessionId, msg.role, msg.text,
          msg.model ?? null,
          msg.interrupted ? 1 : 0,
          msg.error ?? null,
          msg.retryable === undefined ? null : msg.retryable ? 1 : 0,
          now, i,
        );
        insertFts.run(newMsgId, newSessionId, msg.role, msg.text);

        const reIdded: ReasoningStep[] = (msg.reasoningSteps ?? []).map((step) => {
          const newStep: ReasoningStep = {
            ...step,
            id: randomUUID(),
            type: step.type as ReasoningStep['type'],
            timestamp: now,
          };
          if (step.type === 'tool_call' && step.toolCall) {
            newStep.toolCall = { ...step.toolCall, id: randomUUID() };
          }
          return newStep;
        });
        this.insertReasoningSteps(newMsgId, reIdded);

        if (msg.attachments && msg.attachments.length > 0) {
          this.insertAttachments(newMsgId, msg.attachments.map((a) => ({
            ...a,
            id: randomUUID(),
          })));
        }
      });
    });
    tx();

    return {
      id: newSessionId,
      title: session.title,
      createdAt: now,
      updatedAt: now,
      providerName: session.providerName,
    };
  }

  async forkSession(sessionId: string, fromMessageId: string): Promise<SessionMeta> {
    // Read source session metadata
    const src = this.db
      .prepare(
        'SELECT id, title, created_at, updated_at, provider_name, workspace_id FROM sessions WHERE id = ?',
      )
      .get(sessionId) as { id: string; title: string; created_at: number; updated_at: number; provider_name: string | null; workspace_id: string | null } | undefined;
    if (!src) throw new NotFoundError(`session ${sessionId}`);

    // Read all messages with reasoning, in position order
    const all = this.readMessages(sessionId);
    const idx = all.findIndex((m) => m.id === fromMessageId);
    if (idx < 0) throw new ValidationError(`Message ${fromMessageId} not in session ${sessionId}`);

    // Resolve cut-point: walk back from model bubbles to the nearest user message.
    let cut = idx;
    if (all[cut].role === 'model') {
      while (cut >= 0 && all[cut].role !== 'user') cut--;
      if (cut < 0) {
        const err = new ValidationError('NO_FORK_POINT: no user message at or before cut');
        (err as { code?: string }).code = 'NO_FORK_POINT';
        throw err;
      }
    }
    // Inclusive of cut: keep messages at positions 0..cut
    const slice = all.slice(0, cut + 1);

    const newSessionId = randomUUID();
    const now = Date.now();

    const insertMessage = this.db.prepare(
      'INSERT INTO messages (id, session_id, role, content, model, interrupted, error, retryable, created_at, position, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertFts = this.db.prepare(
      'INSERT INTO messages_fts (message_id, session_id, role, content) VALUES (?, ?, ?, ?)',
    );

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO sessions (id, title, created_at, updated_at, provider_name, workspace_id) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(newSessionId, src.title, now, now, src.provider_name, src.workspace_id);

      slice.forEach((msg, i) => {
        const newMsgId = randomUUID();
        insertMessage.run(
          newMsgId, newSessionId, msg.role, msg.text,
          msg.model ?? null,
          msg.interrupted ? 1 : 0,
          msg.error ?? null,
          msg.retryable === undefined ? null : msg.retryable ? 1 : 0,
          now, i,
          msg.tokensIn ?? null,
          msg.tokensOut ?? null,
        );
        insertFts.run(newMsgId, newSessionId, msg.role, msg.text);

        // Re-id reasoning steps + tool calls, reuse insertReasoningSteps helper.
        const reIdded: ReasoningStep[] = (msg.reasoningSteps ?? []).map((step) => {
          const newStep: ReasoningStep = {
            ...step,
            id: randomUUID(),
            type: step.type as ReasoningStep['type'],
            timestamp: now,
          };
          if (step.type === 'tool_call' && step.toolCall) {
            newStep.toolCall = { ...step.toolCall, id: randomUUID() };
          }
          return newStep;
        });
        this.insertReasoningSteps(newMsgId, reIdded);

        if (msg.attachments && msg.attachments.length > 0) {
          msg.attachments.forEach((meta, attIdx) => {
            const row = this.db
              .prepare('SELECT content FROM messages_attachments WHERE id = ?')
              .get(meta.id) as { content: Buffer } | undefined;
            if (!row) return;
            this.db
              .prepare(
                'INSERT INTO messages_attachments (id, message_id, position, mime, name, size, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
              )
              .run(randomUUID(), newMsgId, attIdx, meta.mime, meta.name, meta.size, row.content);
          });
        }
      });
    });
    tx();

    return {
      id: newSessionId,
      title: src.title,
      createdAt: now,
      updatedAt: now,
      providerName: src.provider_name ?? undefined,
    };
  }

  // ---- private helpers ----

  private readMessages(sessionId: string): Message[] {
    const msgRows = this.db
      .prepare(
        'SELECT id, session_id, role, content, model, interrupted, error, retryable, created_at, position, tokens_in, tokens_out FROM messages WHERE session_id = ? ORDER BY position',
      )
      .all(sessionId) as MessageRow[];

    const attachmentRows = this.db
      .prepare(
        'SELECT id, message_id, position, mime, name, size FROM messages_attachments WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?) ORDER BY message_id, position',
      )
      .all(sessionId) as Array<{ id: string; message_id: string; position: number; mime: string; name: string; size: number }>;

    const byMessage = new Map<string, MessageAttachment[]>();
    for (const r of attachmentRows) {
      const arr = byMessage.get(r.message_id) ?? [];
      arr.push({ id: r.id, mime: r.mime, name: r.name, size: r.size });
      byMessage.set(r.message_id, arr);
    }

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
      if (m.tokens_in !== null) msg.tokensIn = m.tokens_in;
      if (m.tokens_out !== null) msg.tokensOut = m.tokens_out;
      const steps = this.readReasoningSteps(m.id);
      if (steps.length > 0) msg.reasoningSteps = steps;
      const atts = byMessage.get(m.id);
      if (atts && atts.length > 0) msg.attachments = atts;
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

  async getAttachmentBytes(id: string): Promise<{ mime: string; name: string; content: Buffer } | null> {
    const row = this.db
      .prepare('SELECT mime, name, content FROM messages_attachments WHERE id = ?')
      .get(id) as { mime: string; name: string; content: Buffer } | undefined;
    if (!row) return null;
    return row;
  }

  private insertAttachments(messageId: string, attachments: MessageAttachment[]): void {
    const stmt = this.db.prepare(
      'INSERT INTO messages_attachments (id, message_id, position, mime, name, size, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    attachments.forEach((a, i) => {
      if (!a.contentBase64) throw new ValidationError(`Attachment ${a.id} missing contentBase64`);
      const bytes = Buffer.from(a.contentBase64, 'base64');
      stmt.run(a.id, messageId, i, a.mime, a.name, a.size, bytes);
    });
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
