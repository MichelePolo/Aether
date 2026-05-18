import { randomUUID } from 'node:crypto';
import { computeTitle } from './title';
import type { Message, SessionRecord, SessionsFile } from './history.types';

const DEFAULT_KEY = 'default';

function isMessageArray(v: unknown): v is Message[] {
  return Array.isArray(v) && v.every((m) =>
    m != null && typeof m === 'object' && 'role' in m && 'text' in m,
  );
}

function isSessionRecord(v: unknown): v is SessionRecord {
  return v != null && typeof v === 'object'
    && 'title' in v && 'createdAt' in v && 'messages' in v;
}

export function migrateLegacyDefault(file: Record<string, unknown>): SessionsFile {
  const legacy = file[DEFAULT_KEY];
  if (legacy === undefined) {
    // Nessuna migrazione necessaria. Filtra solo le voci valide V2.
    const out: SessionsFile = {};
    for (const [k, v] of Object.entries(file)) {
      if (isSessionRecord(v)) out[k] = v;
    }
    return out;
  }

  const out: SessionsFile = {};
  for (const [k, v] of Object.entries(file)) {
    if (k === DEFAULT_KEY) continue;
    if (isSessionRecord(v)) out[k] = v;
  }

  if (!isMessageArray(legacy)) {
    // Caso inatteso: 'default' presente ma non Message[].
    // Se è già una SessionRecord, ri-chiavalo a un UUID. Altrimenti salta.
    if (isSessionRecord(legacy)) {
      out[randomUUID()] = legacy;
    }
    return out;
  }

  const messages = legacy;
  const firstUser = messages.find((m) => m.role === 'user');
  const title = firstUser ? computeTitle(firstUser.text) : 'Sessione importata';
  const createdAt = messages[0]?.timestamp ?? Date.now();

  const newId = randomUUID();
  out[newId] = { title, createdAt, messages };
  return out;
}
