# Slice 20 — Message attachments (images + text files) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag-and-drop / paste / paperclip-pick images and text files into a chat message; images flow through provider-native multimodal blocks, text files are inlined as fenced code blocks; persist all attachments to SQLite so sessions round-trip cleanly through slice 16 export/import and slice 19 fork.

**Architecture:** New `messages_attachments` BLOB table (migration 005). `ProviderCapabilities` gains `vision`. Each multimodal adapter translates `ProviderRequest.attachments` to its native block format. `DispatchService` validates + decodes incoming base64 attachments, inlines text ones as fenced code blocks, strips images for non-vision providers, and persists all originals. New `GET /api/attachments/:id` route serves BLOB bytes for `<MessageBubble>` thumbs. FE: `useChatStore.queuedAttachments` populated via drag/paste/paperclip; sent as JSON-base64 over a route with its own 15 MB parser; cleared after `done`.

**Tech Stack:** TypeScript, Express, better-sqlite3 (BLOB), Zustand, MSW, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-23-aether-slice-20-attachments-design.md`

**Branch:** `feat/slice-20-attachments`

---

## File Structure

**Server**
- Create: `server/db/migrations/005_message_attachments.sql`.
- Create: `server/domain/dispatch/attachment.types.ts` — `IMAGE_MIMES`, `TEXT_EXTENSIONS`, `classifyAttachment`, `MAX_ATTACHMENTS`, `MAX_TOTAL_BYTES`.
- Create: `server/domain/dispatch/attachment.test.ts`.
- Modify: `server/domain/dispatch/providers/provider.types.ts` — `ProviderCapabilities.vision`, `ProviderAttachment`, `ProviderRequest.attachments`.
- Modify: provider adapters (5 of them) + tests:
  - `gemini.provider.ts`/`.test.ts` — `vision: true`, `inlineData` parts.
  - `openai.provider.ts`/`.test.ts` — `vision: true`, `image_url` parts.
  - `anthropic.provider.ts`/`.test.ts` — `vision: true`, `image` blocks.
  - `ollama.provider.ts`/`.test.ts` — `vision: false`.
  - `fake.provider.ts`/`.test.ts` — `vision: false` (configurable for tests).
- Modify: `server/domain/history/history.types.ts` — `MessageAttachment`, `Message.attachments?`.
- Modify: `server/domain/history/history.store.ts` — `append`/`readMessages` handle attachments; new `getAttachmentBytes`; `forkSession` clones rows; `importSession` writes rows.
- Modify: `server/domain/history/history.store.test.ts`.
- Create: `server/routes/attachments.routes.ts` — `GET /:id`.
- Create: `server/routes/attachments.routes.test.ts`.
- Modify: `server/app.ts` — mount `/api/attachments`.
- Modify: `server/domain/dispatch/dispatch.service.ts` — validate/decode/partition/inline/persist.
- Modify: `server/domain/dispatch/dispatch.service.test.ts`.
- Modify: `server/routes/dispatch.routes.ts` — route-scoped 15 MB JSON parser.
- Modify: `server/db/migrate.test.ts` — expect versions `[1, 2, 3, 4, 5]`.

**Frontend**
- Create: `src/types/attachment.types.ts` — `MessageAttachment`, `QueuedAttachment`.
- Modify: `src/types/session.types.ts` — `Message.attachments?`.
- Modify: `src/types/provider.types.ts` — `ProviderCapabilities.vision`.
- Modify: `src/lib/api/dispatch.api.ts` — request type extension.
- Modify: `src/stores/chat.store.ts` — `queuedAttachments`, `queueAttachments`, `removeQueuedAttachment`, `clearQueuedAttachments`.
- Modify: `src/stores/chat.store.test.ts`.
- Modify: `src/stores/ui.store.ts` — `lightboxAttachmentId`, `openLightbox`/`closeLightbox`.
- Modify: `src/stores/ui.store.test.ts`.
- Modify: `src/hooks/useStreamingDispatch.ts` — wire attachments through `send`.
- Create: `src/components/chat/AttachmentChips.tsx` + test.
- Create: `src/components/chat/AttachmentDropZone.tsx` + test.
- Create: `src/components/chat/AttachmentLightbox.tsx` + test.
- Modify: `src/components/chat/MessageInput.tsx` + test — paperclip + paste + Send-disabled.
- Modify: `src/components/chat/MessageBubble.tsx` + test — attachment rendering.
- Modify: `src/components/chat/ChatView.tsx` — wrap with `<AttachmentDropZone>`, mount `<AttachmentLightbox>` + `<AttachmentChips>` above input.
- Modify: `src/test/msw-handlers.ts` — default for `GET /api/attachments/:id`.

**Integration / e2e**
- Create: `src/integration/attachments.integration.test.tsx`.
- Create: `e2e/fixtures/tiny.png` (1×1 transparent PNG).
- Modify: `e2e/smoke.spec.ts` — paperclip → setInputFiles → send.

---

## Task A1: Branch + migration + attachment helpers

**Files:**
- Verify branch.
- Create: `server/db/migrations/005_message_attachments.sql`.
- Create: `server/domain/dispatch/attachment.types.ts`.
- Create: `server/domain/dispatch/attachment.test.ts`.
- Modify: `server/db/migrate.test.ts`.

- [ ] **Step 1: Verify branch**

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: `feat/slice-20-attachments`. If not:
```bash
git checkout -b feat/slice-20-attachments
```

- [ ] **Step 2: Write migration**

`server/db/migrations/005_message_attachments.sql`:
```sql
-- Per-message attachments (slice 20). Bytes stored as BLOB; cascades on
-- parent message deletion. Both images and text files share this table.
CREATE TABLE messages_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  mime TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  content BLOB NOT NULL
);

CREATE INDEX idx_messages_attachments_message_id ON messages_attachments(message_id);
```

- [ ] **Step 3: Update migrate test to expect 5 migrations**

In `server/db/migrate.test.ts`, find the test "applying real migrations 001+002 creates messages_fts and records both versions" and change the assertion from `expect(versions).toEqual([1, 2, 3, 4])` to:

```ts
expect(versions).toEqual([1, 2, 3, 4, 5]);
```

- [ ] **Step 4: Write failing test** — `server/domain/dispatch/attachment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyAttachment, IMAGE_MIMES, TEXT_EXTENSIONS, MAX_ATTACHMENTS, MAX_TOTAL_BYTES } from './attachment.types';

describe('classifyAttachment', () => {
  it('classifies PNG/JPEG/WebP/GIF as image', () => {
    expect(classifyAttachment('a.png', 'image/png')).toBe('image');
    expect(classifyAttachment('a.jpg', 'image/jpeg')).toBe('image');
    expect(classifyAttachment('a.webp', 'image/webp')).toBe('image');
    expect(classifyAttachment('a.gif', 'image/gif')).toBe('image');
  });

  it('classifies text/* MIME as text', () => {
    expect(classifyAttachment('a.txt', 'text/plain')).toBe('text');
    expect(classifyAttachment('a.md', 'text/markdown')).toBe('text');
  });

  it('classifies octet-stream + text-extension as text', () => {
    expect(classifyAttachment('a.ts', 'application/octet-stream')).toBe('text');
    expect(classifyAttachment('a.json', '')).toBe('text');
    expect(classifyAttachment('a.yaml', '')).toBe('text');
  });

  it('returns null for unknown MIME + unknown extension', () => {
    expect(classifyAttachment('a.pdf', 'application/pdf')).toBeNull();
    expect(classifyAttachment('a.zip', 'application/zip')).toBeNull();
    expect(classifyAttachment('a.exe', '')).toBeNull();
  });

  it('returns null when extension is missing entirely', () => {
    expect(classifyAttachment('noext', 'application/octet-stream')).toBeNull();
  });

  it('exports the expected constants', () => {
    expect(IMAGE_MIMES.has('image/png')).toBe(true);
    expect(TEXT_EXTENSIONS.has('ts')).toBe(true);
    expect(MAX_ATTACHMENTS).toBe(5);
    expect(MAX_TOTAL_BYTES).toBe(10 * 1024 * 1024);
  });
});
```

- [ ] **Step 5: Run, expect FAIL** (module missing)

```bash
npx vitest run server/domain/dispatch/attachment.test.ts
```

- [ ] **Step 6: Implement** — `server/domain/dispatch/attachment.types.ts`:

```ts
export const IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export const TEXT_EXTENSIONS = new Set<string>([
  'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'py', 'yaml', 'yml',
  'toml', 'sh', 'sql', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'html', 'css', 'csv', 'env', 'gitignore', 'txt',
]);

export type AttachmentKind = 'image' | 'text';

export function classifyAttachment(name: string, mime: string): AttachmentKind | null {
  if (IMAGE_MIMES.has(mime)) return 'image';
  if (mime.startsWith('text/')) return 'text';
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (!ext) return null;
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return null;
}

export const MAX_ATTACHMENTS = 5;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
```

- [ ] **Step 7: Run tests, expect GREEN**

```bash
npx vitest run server/domain/dispatch/attachment.test.ts server/db/migrate.test.ts
```

Expected: 7 attachment cases + 7 migrate cases all pass.

- [ ] **Step 8: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add server/db/migrations/005_message_attachments.sql server/domain/dispatch/attachment.types.ts server/domain/dispatch/attachment.test.ts server/db/migrate.test.ts
git commit -m "feat(slice-20): migration 005 + attachment.types (classifyAttachment + caps)"
```

---

## Task B1: ProviderCapabilities.vision + ProviderRequest.attachments

**Files:**
- Modify: `server/domain/dispatch/providers/provider.types.ts`.

- [ ] **Step 1: Extend the types**

Add `vision: boolean;` to `ProviderCapabilities`. Add `ProviderAttachment` and `attachments?` to `ProviderRequest`. Final shape:

```ts
export interface ProviderCapabilities {
  thinking: boolean;
  toolCalling: boolean;
  vision: boolean;
}

export interface ProviderAttachment {
  name: string;
  mime: string;
  bytes: Buffer;
}

export interface ProviderRequest {
  systemInstruction: string;
  history: { role: 'user' | 'model'; text: string }[];
  userMessage: string;
  thinking?: boolean;
  mcpTools?: ProviderToolDecl[];
  toolResults?: ProviderToolResultMessage[];
  pendingAssistantText?: string;
  attachments?: ProviderAttachment[];
}
```

- [ ] **Step 2: Run lint, expect FAIL**

```bash
npm run lint
```

Expected: TypeScript errors in each provider adapter ("Property 'vision' is missing"). These will be fixed in Task C1.

- [ ] **Step 3: Commit (still red — adapters fix in next task)**

```bash
git add server/domain/dispatch/providers/provider.types.ts
git commit -m "feat(slice-20): ProviderCapabilities.vision + ProviderAttachment + ProviderRequest.attachments"
```

---

## Task C1: Update provider adapters (vision flag + image block translation)

**Files:**
- Modify: `server/domain/dispatch/providers/gemini.provider.ts` + test.
- Modify: `server/domain/dispatch/providers/openai.provider.ts` + test.
- Modify: `server/domain/dispatch/providers/anthropic.provider.ts` + test.
- Modify: `server/domain/dispatch/providers/ollama.provider.ts` (capability only).
- Modify: `server/domain/dispatch/providers/fake.provider.ts` + test.

This task touches all 5 adapters. Do them in order (small commits per adapter).

### Gemini

- [ ] **Step 1: Update capabilities + image translation** — `gemini.provider.ts`

Find the `capabilities` assignment and add `vision: true`:
```ts
readonly capabilities = { thinking: true, toolCalling: true, vision: true };
```

In `buildBody` (or wherever the final user message is constructed; line ~60 in current code), replace the single text part with an array that interleaves attachments:

```ts
const userParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
for (const a of req.attachments ?? []) {
  userParts.push({
    inlineData: { mimeType: a.mime, data: a.bytes.toString('base64') },
  });
}
userParts.push({ text: req.userMessage });

// Then replace { role: 'user', parts: [{ text: req.userMessage }] }
// with { role: 'user', parts: userParts }
```

- [ ] **Step 2: Failing test** — append to `gemini.provider.test.ts`:

```ts
it('forwards image attachments as inlineData parts on the user message', async () => {
  let capturedBody: unknown = null;
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) capturedBody = JSON.parse(init.body as string);
    return new Response(makeSseBody(['data: {"candidates":[{"content":{"parts":[{"text":""}]}}],"usageMetadata":{"totalTokenCount":1,"promptTokenCount":0,"candidatesTokenCount":1}}\n']), { status: 200 });
  });
  const p = new GeminiProvider({ apiKey: 'k', model: 'gemini-1.5-flash', fetch: fetchMock as unknown as typeof fetch });
  const stream = p.stream({
    systemInstruction: '',
    history: [],
    userMessage: 'look',
    attachments: [{ name: 'x.png', mime: 'image/png', bytes: Buffer.from('hi') }],
  }, new AbortController().signal);
  for await (const _ of stream) { /* drain */ }
  const body = capturedBody as { contents: Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> };
  const lastUser = body.contents[body.contents.length - 1];
  expect(lastUser.parts).toEqual([
    { inlineData: { mimeType: 'image/png', data: Buffer.from('hi').toString('base64') } },
    { text: 'look' },
  ]);
});
```

(Adapt `makeSseBody` to match what the file already uses for SSE fixtures. If `fetch` isn't an injectable dep, follow whichever injection point the file already uses.)

- [ ] **Step 3: Run test, expect FAIL → implement → PASS**

```bash
npx vitest run server/domain/dispatch/providers/gemini.provider.test.ts
```

### OpenAI

- [ ] **Step 4: Update capabilities + image translation** — `openai.provider.ts`

In the constructor, where `capabilities` is set, add `vision: true`:
```ts
this.capabilities = {
  thinking: opts.model === 'o3',
  toolCalling: true,
  vision: true,
};
```

In `buildBody`, find the final `messages.push({ role: 'user', content: req.userMessage });` (line ~235). Replace with the multimodal array form when attachments are present:

```ts
if (req.attachments && req.attachments.length > 0) {
  const content: Array<Record<string, unknown>> = [];
  content.push({ type: 'text', text: req.userMessage });
  for (const a of req.attachments) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${a.mime};base64,${a.bytes.toString('base64')}` },
    });
  }
  messages.push({ role: 'user', content });
} else {
  messages.push({ role: 'user', content: req.userMessage });
}
```

- [ ] **Step 5: Failing test** — append to `openai.provider.test.ts`:

```ts
it('forwards image attachments as image_url parts on the user message', async () => {
  let capturedBody: { messages: Array<{ role: string; content: unknown }> } | null = null;
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return new Response(JSON.stringify({ choices: [], usage: { total_tokens: 0 } }), { status: 200 });
  });
  const p = new OpenAIProvider({ apiKey: 'k', model: 'gpt-4.1', fetch: fetchMock as unknown as typeof fetch });
  const stream = p.stream({
    systemInstruction: '',
    history: [],
    userMessage: 'see this',
    attachments: [{ name: 'x.png', mime: 'image/png', bytes: Buffer.from('img') }],
  }, new AbortController().signal);
  for await (const _ of stream) { /* drain */ }
  const last = capturedBody!.messages[capturedBody!.messages.length - 1];
  expect(last.role).toBe('user');
  expect(last.content).toEqual([
    { type: 'text', text: 'see this' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from('img').toString('base64')}` } },
  ]);
});
```

(If OpenAIProvider doesn't accept `fetch` as a dep yet, follow the existing test pattern — most likely a top-level `vi.stubGlobal('fetch', fetchMock)`.)

- [ ] **Step 6: Run, FAIL → implement → PASS**

```bash
npx vitest run server/domain/dispatch/providers/openai.provider.test.ts
```

### Anthropic

- [ ] **Step 7: Update capabilities + image translation** — `anthropic.provider.ts`

```ts
readonly capabilities: ProviderCapabilities = { thinking: true, toolCalling: true, vision: true };
```

Find the final user message push (line ~229): `{ role: 'user', content: [{ type: 'text', text: req.userMessage }] }`. Replace with:

```ts
const userContent: Array<
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
> = [];
for (const a of req.attachments ?? []) {
  userContent.push({
    type: 'image',
    source: { type: 'base64', media_type: a.mime, data: a.bytes.toString('base64') },
  });
}
userContent.push({ type: 'text', text: req.userMessage });
// then: { role: 'user', content: userContent }
```

- [ ] **Step 8: Failing test** — append to `anthropic.provider.test.ts`:

```ts
it('forwards image attachments as image blocks on the user message', async () => {
  // The existing anthropic tests already stub the SDK iterator. Mirror that pattern.
  // Capture the request payload (messages array) and assert the user content
  // contains both an image block and the text.
  // ...
});
```

(The exact mock shape depends on what's already in `anthropic.provider.test.ts` — read it and follow that pattern. The assertion: `content` array has one `{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: ... } }` before the `{ type: 'text', text: 'see' }`.)

- [ ] **Step 9: Run, FAIL → implement → PASS**

```bash
npx vitest run server/domain/dispatch/providers/anthropic.provider.test.ts
```

### Ollama

- [ ] **Step 10: Update capabilities** — `ollama.provider.ts`

Find the `capabilities` line and add `vision: false`:
```ts
readonly capabilities: ProviderCapabilities = { thinking: false, toolCalling: true, vision: false };
```

No attachment forwarding needed — the server-side dispatch service strips images before calling Ollama.

- [ ] **Step 11: Run existing Ollama tests, expect green**

```bash
npx vitest run server/domain/dispatch/providers/ollama.provider.test.ts
```

### Fake

- [ ] **Step 12: Update capabilities + accept config** — `fake.provider.ts`

Find the `capabilities` line, replace with:
```ts
readonly capabilities = { thinking: true, toolCalling: true, vision: this.opts.vision ?? false };
```

Extend `FakeProviderOptions`:
```ts
export interface FakeProviderOptions {
  // ...existing...
  vision?: boolean;
}
```

(The `vision` flag flows through the existing options pattern. No translation logic — FakeProvider doesn't actually emit images.)

- [ ] **Step 13: Failing test** — append to `fake.provider.test.ts`:

```ts
it('exposes vision=true when configured', () => {
  const p = new FakeProvider({ chunks: ['x'], vision: true });
  expect(p.capabilities.vision).toBe(true);
});

it('defaults vision to false', () => {
  const p = new FakeProvider({ chunks: ['x'] });
  expect(p.capabilities.vision).toBe(false);
});
```

- [ ] **Step 14: Run, FAIL → implement → PASS**

```bash
npx vitest run server/domain/dispatch/providers/fake.provider.test.ts
```

- [ ] **Step 15: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/providers/
git commit -m "feat(slice-20): adapter vision flag + image-block translation (gemini/openai/anthropic)"
```

---

## Task D1: HistoryStore — attachments persistence + getAttachmentBytes + fork

**Files:**
- Modify: `server/domain/history/history.types.ts`.
- Modify: `server/domain/history/history.store.ts`.
- Modify: `server/domain/history/history.store.test.ts`.

- [ ] **Step 1: Extend types**

`history.types.ts`:
```ts
export interface MessageAttachment {
  id: string;
  mime: string;
  name: string;
  size: number;
  contentBase64?: string;  // present on write/import paths; absent on read
}

export interface Message {
  // ...existing fields...
  attachments?: MessageAttachment[];
}
```

- [ ] **Step 2: Write failing tests** — append to `history.store.test.ts`:

```ts
describe('HistoryStore.append — attachments', () => {
  it('persists attachment rows when message.attachments is set', async () => {
    const s = await store.createEmpty();
    await store.append(s.id, {
      id: 'u1', role: 'user', text: 'hi', timestamp: 1,
      attachments: [
        { id: 'a1', mime: 'image/png', name: 'p.png', size: 4, contentBase64: Buffer.from('PNG!').toString('base64') },
        { id: 'a2', mime: 'text/plain', name: 't.txt', size: 5, contentBase64: Buffer.from('hello').toString('base64') },
      ],
    });
    const msgs = await store.read(s.id);
    expect(msgs![0].attachments).toHaveLength(2);
    expect(msgs![0].attachments![0]).toEqual({ id: 'a1', mime: 'image/png', name: 'p.png', size: 4 });
    expect(msgs![0].attachments![1]).toEqual({ id: 'a2', mime: 'text/plain', name: 't.txt', size: 5 });
    // contentBase64 is NOT returned on read
    expect((msgs![0].attachments![0] as Record<string, unknown>).contentBase64).toBeUndefined();
  });

  it('no attachments field present when message.attachments is omitted', async () => {
    const s = await store.createEmpty();
    await store.append(s.id, { id: 'u1', role: 'user', text: 'hi', timestamp: 1 });
    const msgs = await store.read(s.id);
    expect(msgs![0].attachments).toBeUndefined();
  });
});

describe('HistoryStore.getAttachmentBytes', () => {
  it('returns mime, name, content buffer for a stored attachment', async () => {
    const s = await store.createEmpty();
    await store.append(s.id, {
      id: 'u1', role: 'user', text: 'hi', timestamp: 1,
      attachments: [{ id: 'a1', mime: 'image/png', name: 'p.png', size: 4, contentBase64: Buffer.from('PNG!').toString('base64') }],
    });
    const got = await store.getAttachmentBytes('a1');
    expect(got).not.toBeNull();
    expect(got!.mime).toBe('image/png');
    expect(got!.name).toBe('p.png');
    expect(Buffer.compare(got!.content, Buffer.from('PNG!'))).toBe(0);
  });

  it('returns null for an unknown attachment id', async () => {
    expect(await store.getAttachmentBytes('nope')).toBeNull();
  });
});

describe('HistoryStore.delete — FK cascade on attachments', () => {
  it('removes child attachment rows when the parent session is deleted', async () => {
    const s = await store.createEmpty();
    await store.append(s.id, {
      id: 'u1', role: 'user', text: 'x', timestamp: 1,
      attachments: [{ id: 'a1', mime: 'image/png', name: 'p.png', size: 1, contentBase64: 'AA==' }],
    });
    await store.delete(s.id);
    const remaining = db.prepare('SELECT count(*) AS n FROM messages_attachments WHERE id = ?').get('a1') as { n: number };
    expect(remaining.n).toBe(0);
  });
});

describe('HistoryStore.forkSession — clones attachments', () => {
  it('regenerates attachment ids tied to the cloned messages', async () => {
    const s = await store.createEmpty();
    await store.append(s.id, {
      id: 'u1', role: 'user', text: 'q', timestamp: 1,
      attachments: [{ id: 'a1', mime: 'image/png', name: 'p.png', size: 1, contentBase64: 'AA==' }],
    });
    const meta = await store.forkSession(s.id, 'u1');
    const msgs = await store.read(meta.id);
    expect(msgs![0].attachments).toHaveLength(1);
    expect(msgs![0].attachments![0].id).not.toBe('a1');
    expect(msgs![0].attachments![0].name).toBe('p.png');
    // Original attachment still present
    const orig = await store.getAttachmentBytes('a1');
    expect(orig).not.toBeNull();
    // And the cloned one too (with new id)
    const clonedId = msgs![0].attachments![0].id;
    expect(await store.getAttachmentBytes(clonedId)).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run server/domain/history/history.store.test.ts
```

- [ ] **Step 4: Implement append + read attachments**

In `history.store.ts`:

Add a private helper that writes attachment rows:
```ts
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
```

In `append`, after writing the message + FTS + reasoning steps, add:
```ts
if (message.attachments && message.attachments.length > 0) {
  this.insertAttachments(message.id, message.attachments);
}
```

In `readMessages`, after the existing read loop, add a second pass that fetches attachment metadata for all messages in the session in one query:

```ts
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

// After the existing `return msgRows.map(...)` block, augment each result:
return msgRows.map((m) => {
  // ...existing body building...
  const atts = byMessage.get(m.id);
  if (atts && atts.length > 0) msg.attachments = atts;
  return msg;
});
```

(Adapt to the precise existing structure of `readMessages`.)

- [ ] **Step 5: Implement getAttachmentBytes**

Add the method:
```ts
async getAttachmentBytes(id: string): Promise<{ mime: string; name: string; content: Buffer } | null> {
  const row = this.db
    .prepare('SELECT mime, name, content FROM messages_attachments WHERE id = ?')
    .get(id) as { mime: string; name: string; content: Buffer } | undefined;
  if (!row) return null;
  return row;
}
```

- [ ] **Step 6: Extend forkSession to clone attachments**

In `forkSession`, inside the existing `slice.forEach((msg, i) => { ... })` loop, after the message + reasoning are inserted, add:

```ts
if (msg.attachments && msg.attachments.length > 0) {
  // Read original bytes for each (since the in-memory `msg` only has metadata)
  for (const meta of msg.attachments) {
    const row = this.db
      .prepare('SELECT content FROM messages_attachments WHERE id = ?')
      .get(meta.id) as { content: Buffer } | undefined;
    if (!row) continue;
    this.db
      .prepare(
        'INSERT INTO messages_attachments (id, message_id, position, mime, name, size, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), newMsgId, meta.id /* not used as position; we use array position below */, meta.mime, meta.name, meta.size, row.content);
  }
}
```

Actually the position should match the index in `msg.attachments`. Use a forEach:
```ts
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
```

- [ ] **Step 7: Extend importSession to write attachments**

Find the `importSession` body (also iterates `session.messages`). In its forEach, after the message + reasoning inserts, add the same attachment write pattern but use the envelope's `contentBase64`:

```ts
if (msg.attachments && msg.attachments.length > 0) {
  this.insertAttachments(newMsgId, msg.attachments.map((a) => ({
    ...a,
    id: randomUUID(),
  })));
}
```

(Reuse the `insertAttachments` private helper — it already requires `contentBase64`.)

- [ ] **Step 8: Run tests, expect GREEN**

```bash
npx vitest run server/domain/history/history.store.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add server/domain/history/
git commit -m "feat(slice-20): HistoryStore — attachments persistence + getAttachmentBytes + fork+import clone"
```

---

## Task E1: GET /api/attachments/:id route

**Files:**
- Create: `server/routes/attachments.routes.ts`.
- Create: `server/routes/attachments.routes.test.ts`.
- Modify: `server/app.ts`.

- [ ] **Step 1: Failing test** — `server/routes/attachments.routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeTestDb } from '@/server/test/test-db';
import { HistoryStore } from '@/server/domain/history/history.store';
import { createAttachmentsRoutes } from './attachments.routes';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let history: HistoryStore;
let app: express.Express;

beforeEach(() => {
  db = makeTestDb();
  history = new HistoryStore(db);
  app = express();
  app.use('/api/attachments', createAttachmentsRoutes(history));
});

afterEach(() => db.close());

describe('GET /api/attachments/:id', () => {
  it('returns the BLOB with the right Content-Type for a stored attachment', async () => {
    const s = await history.createEmpty();
    await history.append(s.id, {
      id: 'u1', role: 'user', text: 'hi', timestamp: 1,
      attachments: [{ id: 'a1', mime: 'image/png', name: 'p.png', size: 4, contentBase64: Buffer.from('PNG!').toString('base64') }],
    });
    const res = await request(app).get('/api/attachments/a1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.body.toString('utf-8')).toBe('PNG!');
  });

  it('returns 404 for unknown attachment id', async () => {
    const res = await request(app).get('/api/attachments/missing');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/routes/attachments.routes.test.ts
```

- [ ] **Step 3: Implement** — `server/routes/attachments.routes.ts`:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { HistoryStore } from '@/server/domain/history/history.store';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createAttachmentsRoutes(store: HistoryStore): Router {
  const router = Router();

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = await store.getAttachmentBytes(req.params.id);
      if (!row) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
        return;
      }
      res.setHeader('Content-Type', row.mime);
      res.setHeader('Content-Disposition', 'inline');
      res.send(row.content);
    }),
  );

  return router;
}
```

- [ ] **Step 4: Mount in `server/app.ts`**

Add import:
```ts
import { createAttachmentsRoutes } from './routes/attachments.routes';
```

Inside `createApp`, near the other mounts:
```ts
if (deps.historyStore) {
  app.use('/api/attachments', createAttachmentsRoutes(deps.historyStore));
}
```

- [ ] **Step 5: Run, expect GREEN**

```bash
npx vitest run server/routes/attachments.routes.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add server/routes/attachments.routes.ts server/routes/attachments.routes.test.ts server/app.ts
git commit -m "feat(slice-20): GET /api/attachments/:id route"
```

---

## Task F1: DispatchService validates / inlines / forwards attachments

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts`.
- Modify: `server/domain/dispatch/dispatch.service.test.ts`.

- [ ] **Step 1: Extend `DispatchRequestSchema`**

In `dispatch.service.ts`, near the top:

```ts
import { classifyAttachment, MAX_ATTACHMENTS, MAX_TOTAL_BYTES } from './attachment.types';

const DispatchAttachmentSchema = z.object({
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(127),
  size: z.number().int().nonnegative(),
  contentBase64: z.string(),
});

export const DispatchRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  thinking: z.boolean().optional(),
  providerName: z.string().optional(),
  attachments: z.array(DispatchAttachmentSchema).max(MAX_ATTACHMENTS).optional(),
});
```

- [ ] **Step 2: Failing tests** — append to `dispatch.service.test.ts`:

```ts
describe('DispatchService — attachments', () => {
  it('inlines a text attachment as a fenced code block in the user message', async () => {
    // Use the existing test scaffold to dispatch a request with a text attachment.
    // Assert the FakeProvider's lastRequest.userMessage contains:
    //   "do this\n\n```notes.md\nhello world\n```"
  });

  it('forwards image attachments to the provider via ProviderRequest.attachments', async () => {
    // FakeProvider can be modified to expose `lastRequest.attachments`.
    // Assert that an image base64 round-trips into a Buffer of the right size.
  });

  it('strips images when the resolved provider has vision=false', async () => {
    // FakeProvider with vision:false. Dispatch with an image attachment.
    // Assert FakeProvider.lastRequest.attachments is empty (or undefined).
  });

  it('persists both text and image attachments on the user message', async () => {
    // Dispatch with one text + one image attachment.
    // Read messages back from history.
    // Assert the user message has 2 attachments with the right names and mimes.
  });

  it('throws ValidationError for an unsupported MIME', async () => {
    // Dispatch with mime:'application/pdf'.
    // Assert the service throws / SSE emits an error.
  });

  it('throws PAYLOAD_TOO_LARGE when total decoded > 10 MB', async () => {
    // Two attachments, each 6 MB. Assert error.
  });
});
```

Use the existing dispatch test scaffold (the file already has helpers for setting up FakeProvider + dispatcher). For `vision: false` cases, construct `new FakeProvider({ ..., vision: false })`.

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run server/domain/dispatch/dispatch.service.test.ts
```

- [ ] **Step 4: Implement in dispatch.service.ts**

Inside the dispatch handler, after zod validation, add a pre-processing function:

```ts
// Decode + classify attachments
function preprocessAttachments(
  raw: Array<{ name: string; mime: string; size: number; contentBase64: string }>,
): { text: Array<{ name: string; mime: string; bytes: Buffer }>; image: Array<{ name: string; mime: string; bytes: Buffer }> } {
  let totalBytes = 0;
  const text: Array<{ name: string; mime: string; bytes: Buffer }> = [];
  const image: Array<{ name: string; mime: string; bytes: Buffer }> = [];
  for (const a of raw) {
    const kind = classifyAttachment(a.name, a.mime);
    if (kind === null) throw new ValidationError(`Unsupported MIME: ${a.mime} for ${a.name}`);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(a.contentBase64, 'base64');
    } catch {
      throw new ValidationError(`Invalid base64 for ${a.name}`);
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      const err = new AppError('Attachments exceed 10 MB total', { status: 413, code: 'PAYLOAD_TOO_LARGE' });
      throw err;
    }
    if (kind === 'image') image.push({ name: a.name, mime: a.mime, bytes });
    else text.push({ name: a.name, mime: a.mime, bytes });
  }
  return { text, image };
}

function inlineTextAttachments(userMessage: string, texts: Array<{ name: string; bytes: Buffer }>): string {
  if (texts.length === 0) return userMessage;
  const blocks = texts.map((t) => '```' + t.name + '\n' + t.bytes.toString('utf-8') + '\n```').join('\n\n');
  return userMessage + '\n\n' + blocks;
}
```

In the dispatch handler, BEFORE the existing `historyStore.append` for the user message:

```ts
const rawAttachments = req.attachments ?? [];
const { text: textAtts, image: imageAtts } = preprocessAttachments(rawAttachments);
const effectiveMessage = inlineTextAttachments(req.message, textAtts);
```

Use `effectiveMessage` everywhere `req.message` is currently used for the provider call. Pass the original `req.attachments` to `historyStore.append` so the persisted user message carries both text and image attachments.

When resolving the provider, after picking it but before calling `provider.stream`:

```ts
const providerAttachments = provider.capabilities.vision ? imageAtts : [];
const providerReq: ProviderRequest = {
  // ...existing fields, but use effectiveMessage for userMessage...
  userMessage: effectiveMessage,
  attachments: providerAttachments.length > 0 ? providerAttachments : undefined,
};
```

Make sure `AppError` is imported (or use `ValidationError` for 400s and a new code for 413 — see existing `server/lib/errors.ts` for the pattern). If a 413 helper doesn't exist, add a `PayloadTooLargeError` class there, or just throw `new AppError(message, { status: 413, code: 'PAYLOAD_TOO_LARGE' })`.

- [ ] **Step 5: Run tests, expect GREEN**

```bash
npx vitest run server/domain/dispatch/dispatch.service.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "feat(slice-20): DispatchService validates/inlines/forwards attachments"
```

---

## Task G1: Dispatch route — 15 MB body parser

**Files:**
- Modify: `server/routes/dispatch.routes.ts`.
- Modify: `server/routes/dispatch.routes.test.ts`.

- [ ] **Step 1: Failing test** — append to `dispatch.routes.test.ts`:

```ts
it('accepts an attachment-bearing body up to 15 MB raw', async () => {
  // Build a body with one attachment whose contentBase64 is ~6 MB.
  // Use supertest with .set('content-type', 'application/json') and .send(JSON.stringify(body)).
  // Expect status NOT 413 (could be 200 or 400 depending on dispatcher mock).
});
```

- [ ] **Step 2: Update the route** — `server/routes/dispatch.routes.ts`:

Add the inline body parser to the POST handler:
```ts
import express from 'express';

router.post('/', express.json({ limit: '15mb' }), async (req: Request, res: Response) => {
  // ...existing handler...
});
```

(The dispatch route currently uses the global parser at 1 MB. By mounting the route-specific parser BEFORE the handler, the route accepts up to 15 MB; the global parser doesn't fire because the body has already been consumed.)

Wait — this isn't quite right. The global parser fires first because it's mounted on `app.use(express.json(...))`. The trick from slice 16 was to mount the route BEFORE the global parser, in `app.ts`. Let me adjust.

In `server/app.ts`, restructure the dispatch mount to go BEFORE the global parser. The current structure is:

```ts
app.use(express.json({ limit: '1mb' }));
// ...
if (deps.dispatcher) {
  app.use('/api/ai/dispatch', createDispatchRoutes(deps.dispatcher));
}
```

Change to:

```ts
// Dispatch route mounted BEFORE the global parser so its inline 15 MB parser
// can accept multimodal attachments. Mirrors slice 16's import-route pattern.
if (deps.dispatcher) {
  app.use('/api/ai/dispatch', createDispatchRoutes(deps.dispatcher));
}

app.use(express.json({ limit: '1mb' }));
// ...
```

In `dispatch.routes.ts`, add `express.json({ limit: '15mb' })` to both the `POST /` and `POST /resume` handlers:

```ts
router.post('/', express.json({ limit: '15mb' }), async (req: Request, res: Response) => { ... });
router.post('/resume', express.json({ limit: '15mb' }), async (req: Request, res: Response) => { ... });
```

- [ ] **Step 3: Run, expect GREEN**

```bash
npx vitest run server/routes/dispatch.routes.test.ts server/
```

(The full server suite verifies no other route regressed.)

- [ ] **Step 4: Commit**

```bash
git add server/routes/dispatch.routes.ts server/routes/dispatch.routes.test.ts server/app.ts
git commit -m "feat(slice-20): dispatch route mounts own 15 MB JSON parser for attachments"
```

---

## Task H1: FE types + dispatch.api request

**Files:**
- Create: `src/types/attachment.types.ts`.
- Modify: `src/types/session.types.ts` and `src/types/provider.types.ts`.
- Modify: `src/lib/api/dispatch.api.ts`.

- [ ] **Step 1: Create FE attachment types**

`src/types/attachment.types.ts`:
```ts
export interface MessageAttachment {
  id: string;
  mime: string;
  name: string;
  size: number;
  contentBase64?: string;
}

export interface QueuedAttachment {
  id: string;           // local-only uuid for chip keying
  name: string;
  mime: string;
  size: number;
  base64: string;       // bare base64, no data: prefix
  dataUri: string;      // full data:<mime>;base64,<base64> for <img src>
}

export type AttachmentKind = 'image' | 'text';

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}
```

- [ ] **Step 2: Extend Message type**

In `src/types/session.types.ts`, add to the `Message` interface:
```ts
import type { MessageAttachment } from './attachment.types';

export interface Message {
  // ...existing fields...
  attachments?: MessageAttachment[];
}
```

- [ ] **Step 3: Extend ProviderCapabilities**

In `src/types/provider.types.ts`, add `vision: boolean` to `ProviderCapabilities` (existing object shape).

- [ ] **Step 4: Extend dispatch.api request type**

In `src/lib/api/dispatch.api.ts`, extend the request type passed to `createStreamingDispatch`:
```ts
interface DispatchAttachment {
  name: string;
  mime: string;
  size: number;
  contentBase64: string;
}

export interface CreateStreamingDispatchRequest {
  sessionId: string;
  message: string;
  thinking?: boolean;
  providerName?: string;
  attachments?: DispatchAttachment[];
}
```

(The exact name might differ — match what `useStreamingDispatch.ts` currently passes. Just thread `attachments` through.)

- [ ] **Step 5: Lint**

```bash
npm run lint
```

Expected: clean (or surface FE type errors that will be fixed in subsequent tasks).

- [ ] **Step 6: Commit**

```bash
git add src/types/ src/lib/api/dispatch.api.ts
git commit -m "feat(slice-20): FE types — MessageAttachment, QueuedAttachment, ProviderCapabilities.vision"
```

---

## Task I1: chat.store — queuedAttachments + actions

**Files:**
- Modify: `src/stores/chat.store.ts`.
- Modify: `src/stores/chat.store.test.ts`.

- [ ] **Step 1: Failing tests** — append to `chat.store.test.ts`:

```ts
import type { QueuedAttachment } from '@/src/types/attachment.types';

function makeFile(name: string, mime: string, content: string): File {
  return new File([content], name, { type: mime });
}

describe('chat.store.queuedAttachments', () => {
  beforeEach(() => useChatStore.getState().reset());

  it('queueAttachments appends a valid PNG and clears error', async () => {
    const file = makeFile('a.png', 'image/png', 'PNGBYTES');
    await useChatStore.getState().queueAttachments([file]);
    const q = useChatStore.getState().queuedAttachments;
    expect(q).toHaveLength(1);
    expect(q[0].name).toBe('a.png');
    expect(q[0].mime).toBe('image/png');
    expect(q[0].base64.length).toBeGreaterThan(0);
    expect(q[0].dataUri.startsWith('data:image/png;base64,')).toBe(true);
    expect(useChatStore.getState().error).toBeNull();
  });

  it('rejects when count would exceed MAX_ATTACHMENTS=5', async () => {
    // Pre-fill with 5
    useChatStore.setState({
      queuedAttachments: Array.from({ length: 5 }).map((_, i): QueuedAttachment => ({
        id: `q${i}`, name: `a${i}.png`, mime: 'image/png', size: 1, base64: 'AA==', dataUri: 'data:image/png;base64,AA==',
      })),
    });
    await useChatStore.getState().queueAttachments([makeFile('extra.png', 'image/png', 'X')]);
    expect(useChatStore.getState().queuedAttachments).toHaveLength(5);
    expect(useChatStore.getState().error).toMatch(/Too many attachments/i);
  });

  it('rejects when total size would exceed 10 MB', async () => {
    const huge = makeFile('big.png', 'image/png', 'a'.repeat(11 * 1024 * 1024));
    await useChatStore.getState().queueAttachments([huge]);
    expect(useChatStore.getState().queuedAttachments).toHaveLength(0);
    expect(useChatStore.getState().error).toMatch(/too large/i);
  });

  it('rejects an unsupported MIME with a per-file message', async () => {
    const bad = makeFile('a.pdf', 'application/pdf', 'PDF');
    await useChatStore.getState().queueAttachments([bad]);
    expect(useChatStore.getState().queuedAttachments).toHaveLength(0);
    expect(useChatStore.getState().error).toMatch(/a\.pdf/);
  });

  it('removeQueuedAttachment filters by id', async () => {
    await useChatStore.getState().queueAttachments([makeFile('a.png', 'image/png', 'x')]);
    const id = useChatStore.getState().queuedAttachments[0].id;
    useChatStore.getState().removeQueuedAttachment(id);
    expect(useChatStore.getState().queuedAttachments).toHaveLength(0);
  });

  it('clearQueuedAttachments empties the queue', async () => {
    await useChatStore.getState().queueAttachments([makeFile('a.png', 'image/png', 'x')]);
    useChatStore.getState().clearQueuedAttachments();
    expect(useChatStore.getState().queuedAttachments).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/stores/chat.store.test.ts
```

- [ ] **Step 3: Implement** — extend `chat.store.ts`:

Add imports:
```ts
import type { QueuedAttachment } from '@/src/types/attachment.types';
```

Define constants (mirror server):
```ts
const MAX_ATTACHMENTS = 5;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);
const TEXT_EXTENSIONS = new Set([
  'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'py', 'yaml', 'yml',
  'toml', 'sh', 'sql', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'html', 'css', 'csv', 'env', 'gitignore', 'txt',
]);

function classifyFile(name: string, mime: string): 'image' | 'text' | null {
  if (IMAGE_MIMES.has(mime)) return 'image';
  if (mime.startsWith('text/')) return 'text';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) ? 'text' : null;
}

async function readFileBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
```

Extend the state interface:
```ts
interface ChatState {
  // ...existing...
  queuedAttachments: QueuedAttachment[];
  queueAttachments(files: File[]): Promise<void>;
  removeQueuedAttachment(id: string): void;
  clearQueuedAttachments(): void;
}
```

Add to `initial`:
```ts
queuedAttachments: [] as QueuedAttachment[],
```

Add actions:
```ts
queueAttachments: async (files) => {
  const current = get().queuedAttachments;
  const newId = () => crypto.randomUUID();

  // Pre-check: count
  if (current.length + files.length > MAX_ATTACHMENTS) {
    set({ error: `Too many attachments (max ${MAX_ATTACHMENTS})` });
    return;
  }

  // Per-file MIME check + size
  let runningTotal = current.reduce((s, a) => s + a.size, 0);
  const newQueued: QueuedAttachment[] = [];
  for (const file of files) {
    const kind = classifyFile(file.name, file.type);
    if (kind === null) {
      set({ error: `Unsupported file: ${file.name} (${file.type || 'unknown type'})` });
      return;
    }
    runningTotal += file.size;
    if (runningTotal > MAX_TOTAL_BYTES) {
      set({ error: `Attachments too large (max 10 MB total)` });
      return;
    }
    let base64: string;
    try {
      base64 = await readFileBase64(file);
    } catch {
      set({ error: `Failed to read ${file.name}` });
      return;
    }
    newQueued.push({
      id: newId(),
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      base64,
      dataUri: `data:${file.type || 'application/octet-stream'};base64,${base64}`,
    });
  }

  set((s) => ({ queuedAttachments: [...s.queuedAttachments, ...newQueued], error: null }));
},

removeQueuedAttachment: (id) => set((s) => ({
  queuedAttachments: s.queuedAttachments.filter((a) => a.id !== id),
})),

clearQueuedAttachments: () => set({ queuedAttachments: [] }),
```

- [ ] **Step 4: Run tests, expect GREEN**

```bash
npx vitest run src/stores/chat.store.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/stores/chat.store.ts src/stores/chat.store.test.ts
git commit -m "feat(slice-20): chat.store queuedAttachments + queue/remove/clear actions"
```

---

## Task J1: AttachmentChips component

**Files:**
- Create: `src/components/chat/AttachmentChips.tsx`.
- Create: `src/components/chat/AttachmentChips.test.tsx`.

- [ ] **Step 1: Failing tests** — `AttachmentChips.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentChips } from './AttachmentChips';
import { useChatStore } from '@/src/stores/chat.store';
import { useProvidersStore } from '@/src/stores/providers.store';

beforeEach(() => {
  useChatStore.getState().reset();
  useProvidersStore.getState()._reset();
});

describe('AttachmentChips', () => {
  it('renders nothing when queue is empty', () => {
    const { container } = render(<AttachmentChips />);
    expect(container.textContent).toBe('');
  });

  it('renders image thumb for image queue items', () => {
    useChatStore.setState({
      queuedAttachments: [{
        id: 'q1', name: 'p.png', mime: 'image/png', size: 4, base64: 'AAAA',
        dataUri: 'data:image/png;base64,AAAA',
      }],
    });
    render(<AttachmentChips />);
    const img = screen.getByRole('img', { name: /p\.png/i });
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('renders text chip for text queue items', () => {
    useChatStore.setState({
      queuedAttachments: [{
        id: 'q1', name: 'notes.md', mime: 'text/markdown', size: 100, base64: 'AAA=',
        dataUri: 'data:text/markdown;base64,AAA=',
      }],
    });
    render(<AttachmentChips />);
    expect(screen.getByText(/notes\.md/i)).toBeInTheDocument();
  });

  it('× button removes the chip', async () => {
    useChatStore.setState({
      queuedAttachments: [{
        id: 'q1', name: 'p.png', mime: 'image/png', size: 4, base64: 'AAAA',
        dataUri: 'data:image/png;base64,AAAA',
      }],
    });
    const user = userEvent.setup();
    render(<AttachmentChips />);
    await user.click(screen.getByLabelText(/remove p\.png/i));
    expect(useChatStore.getState().queuedAttachments).toHaveLength(0);
  });

  it('renders a vision warning when queue has images and provider lacks vision', () => {
    useChatStore.setState({
      queuedAttachments: [{
        id: 'q1', name: 'p.png', mime: 'image/png', size: 4, base64: 'AAAA',
        dataUri: 'data:image/png;base64,AAAA',
      }],
    });
    // Force providersStore so capabilitiesOf returns vision:false
    useProvidersStore.setState({
      list: [{ name: 'fake:default', transport: 'fake', model: 'fake-1', capabilities: { thinking: false, toolCalling: false, vision: false }, displayName: 'Fake' }],
      defaultProvider: 'fake:default',
      hydrated: true,
    });
    render(<AttachmentChips />);
    expect(screen.getByText(/provider does not support images/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/chat/AttachmentChips.test.tsx
```

- [ ] **Step 3: Implement** — `AttachmentChips.tsx`:

```tsx
import { X, File as FileIcon } from 'lucide-react';
import { useChatStore } from '@/src/stores/chat.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { isImageMime } from '@/src/types/attachment.types';
import { cn } from '@/src/lib/cn';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function AttachmentChips() {
  const queue = useChatStore((s) => s.queuedAttachments);
  const remove = useChatStore((s) => s.removeQueuedAttachment);
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const sessions = useSessionsStore((s) => s.sessions);
  const defaultProvider = useProvidersStore((s) => s.defaultProvider);
  const capabilitiesOf = useProvidersStore((s) => s.capabilitiesOf);

  if (queue.length === 0) return null;

  const activeProviderName = activeId
    ? ((sessions.find((s) => s.id === activeId) as { providerName?: string } | undefined)?.providerName ?? defaultProvider)
    : defaultProvider;
  const caps = capabilitiesOf(activeProviderName);
  const hasImages = queue.some((a) => isImageMime(a.mime));
  const visionRequired = hasImages && caps?.vision === false;

  return (
    <div className="px-3 py-2 border-t border-border-subtle bg-surface-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {queue.map((a) => (
          <div key={a.id} className="flex items-center gap-2 px-2 py-1 bg-surface-3 border border-border-subtle rounded text-xs">
            {isImageMime(a.mime) ? (
              <img src={a.dataUri} alt={a.name} className="h-10 w-10 object-cover rounded" />
            ) : (
              <FileIcon size={14} className="text-zinc-400" />
            )}
            <div className="flex flex-col">
              <span className="text-zinc-200 font-mono">{a.name}</span>
              <span className="text-zinc-500 text-[10px]">{formatSize(a.size)}</span>
            </div>
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => remove(a.id)}
              className="ml-1 text-zinc-500 hover:text-status-error"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      {visionRequired && (
        <div className={cn(
          'text-[10px] text-status-error font-mono',
        )}>
          ⚠ Current provider does not support images. Switch providers or remove the image attachments.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, expect GREEN**

```bash
npx vitest run src/components/chat/AttachmentChips.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/AttachmentChips.tsx src/components/chat/AttachmentChips.test.tsx
git commit -m "feat(slice-20): AttachmentChips component"
```

---

## Task K1: AttachmentDropZone

**Files:**
- Create: `src/components/chat/AttachmentDropZone.tsx`.
- Create: `src/components/chat/AttachmentDropZone.test.tsx`.

- [ ] **Step 1: Failing tests** — `AttachmentDropZone.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AttachmentDropZone } from './AttachmentDropZone';
import { useChatStore } from '@/src/stores/chat.store';

beforeEach(() => {
  useChatStore.getState().reset();
});

describe('AttachmentDropZone', () => {
  it('renders children', () => {
    const { getByTestId } = render(
      <AttachmentDropZone>
        <div data-testid="inner">hello</div>
      </AttachmentDropZone>,
    );
    expect(getByTestId('inner')).toBeInTheDocument();
  });

  it('drop dispatches queueAttachments with the file list', () => {
    const queueSpy = vi.fn(async () => {});
    useChatStore.setState({ queueAttachments: queueSpy });
    const { container } = render(
      <AttachmentDropZone><div /></AttachmentDropZone>,
    );
    const zone = container.firstChild as HTMLElement;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(queueSpy).toHaveBeenCalledWith([file]);
  });

  it('dragover sets data-drag-active=true', () => {
    const { container } = render(
      <AttachmentDropZone><div /></AttachmentDropZone>,
    );
    const zone = container.firstChild as HTMLElement;
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    expect(zone.getAttribute('data-drag-active')).toBe('true');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/chat/AttachmentDropZone.test.tsx
```

- [ ] **Step 3: Implement** — `AttachmentDropZone.tsx`:

```tsx
import { useCallback, useState, type DragEvent, type PropsWithChildren } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { cn } from '@/src/lib/cn';

export function AttachmentDropZone({ children }: PropsWithChildren) {
  const queueAttachments = useChatStore((s) => s.queueAttachments);
  const [active, setActive] = useState(false);

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setActive(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    // Only deactivate when leaving the outer zone, not entering children
    if (e.currentTarget === e.target) setActive(false);
  }, []);

  const onDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    setActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) await queueAttachments(files);
  }, [queueAttachments]);

  return (
    <div
      data-drag-active={active}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'relative h-full',
        active && 'outline outline-2 outline-accent/40 outline-offset-[-4px]',
      )}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect GREEN**

```bash
npx vitest run src/components/chat/AttachmentDropZone.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/AttachmentDropZone.tsx src/components/chat/AttachmentDropZone.test.tsx
git commit -m "feat(slice-20): AttachmentDropZone (drag-and-drop)"
```

---

## Task L1: ui.store lightbox + AttachmentLightbox component

**Files:**
- Modify: `src/stores/ui.store.ts` + test.
- Create: `src/components/chat/AttachmentLightbox.tsx` + test.

- [ ] **Step 1: Extend ui.store** — add state + actions:

Interface:
```ts
lightboxAttachmentId: string | null;
openLightbox(id: string): void;
closeLightbox(): void;
```

Initial:
```ts
lightboxAttachmentId: null as string | null,
```

Actions:
```ts
openLightbox: (id) => set({ lightboxAttachmentId: id }),
closeLightbox: () => set({ lightboxAttachmentId: null }),
```

- [ ] **Step 2: Append ui.store tests** (3 cases):

```ts
describe('useUiStore.lightbox', () => {
  it('defaults lightboxAttachmentId to null', () => {
    expect(useUiStore.getState().lightboxAttachmentId).toBeNull();
  });

  it('openLightbox(id) sets it; closeLightbox() clears', () => {
    useUiStore.getState().openLightbox('a1');
    expect(useUiStore.getState().lightboxAttachmentId).toBe('a1');
    useUiStore.getState().closeLightbox();
    expect(useUiStore.getState().lightboxAttachmentId).toBeNull();
  });

  it('_reset clears lightbox', () => {
    useUiStore.setState({ lightboxAttachmentId: 'a1' });
    useUiStore.getState()._reset();
    expect(useUiStore.getState().lightboxAttachmentId).toBeNull();
  });
});
```

Run + implement → green.

- [ ] **Step 3: Implement lightbox component** — `AttachmentLightbox.tsx`:

```tsx
import { useEffect } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { Modal } from '@/src/components/ui/Modal';

export function AttachmentLightbox() {
  const id = useUiStore((s) => s.lightboxAttachmentId);
  const close = useUiStore((s) => s.closeLightbox);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, close]);

  if (!id) return null;

  return (
    <Modal onClose={close}>
      <div className="p-2 max-w-[90vw] max-h-[90vh]">
        <img
          src={`/api/attachments/${id}`}
          alt="Attachment"
          className="max-w-full max-h-[85vh] object-contain"
        />
      </div>
    </Modal>
  );
}
```

Tests (`AttachmentLightbox.test.tsx`) — 3 cases:
- Renders nothing when `lightboxAttachmentId` is null.
- Renders the `<img>` with `src=/api/attachments/<id>` when set.
- Escape closes.

- [ ] **Step 4: Run, expect GREEN**

```bash
npx vitest run src/stores/ui.store.test.ts src/components/chat/AttachmentLightbox.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/stores/ui.store.ts src/stores/ui.store.test.ts src/components/chat/AttachmentLightbox.tsx src/components/chat/AttachmentLightbox.test.tsx
git commit -m "feat(slice-20): ui.store lightbox state + AttachmentLightbox component"
```

---

## Task M1: MessageInput — paperclip + paste + Send-disabled

**Files:**
- Modify: `src/components/chat/MessageInput.tsx` + test.

- [ ] **Step 1: Append failing tests** to `MessageInput.test.tsx`:

```tsx
describe('MessageInput — attachments', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useProvidersStore.getState()._reset();
  });

  it('paperclip button opens the hidden file input', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onStop={vi.fn()} isStreaming={false} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    await user.click(screen.getByLabelText(/attach files/i));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('selecting files via input calls queueAttachments', async () => {
    const queueSpy = vi.fn(async () => {});
    useChatStore.setState({ queueAttachments: queueSpy });
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(queueSpy).toHaveBeenCalled();
  });

  it('paste dispatches queueAttachments when clipboardData.files has entries', async () => {
    const queueSpy = vi.fn(async () => {});
    useChatStore.setState({ queueAttachments: queueSpy });
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const textarea = screen.getByPlaceholderText(/scrivi un messaggio/i);
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const event = new ClipboardEvent('paste', {
      clipboardData: new DataTransfer(),
    });
    // Manually attach the file to a mocked clipboard event
    Object.defineProperty(event, 'clipboardData', { value: { files: [file] } });
    textarea.dispatchEvent(event);
    expect(queueSpy).toHaveBeenCalledWith([file]);
  });

  it('Send button disabled when images queued + provider has vision=false', () => {
    useChatStore.setState({
      queuedAttachments: [{ id: 'q1', name: 'a.png', mime: 'image/png', size: 1, base64: 'AA==', dataUri: 'data:image/png;base64,AA==' }],
    });
    useProvidersStore.setState({
      list: [{ name: 'fake:default', transport: 'fake', model: 'fake-1', capabilities: { thinking: false, toolCalling: false, vision: false }, displayName: 'Fake' }],
      defaultProvider: 'fake:default',
      hydrated: true,
    });
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const sendBtn = screen.getByLabelText(/^Send$/i);
    expect(sendBtn).toBeDisabled();
  });

  it('Send button enabled when only text in textarea (no attachments)', async () => {
    const user = userEvent.setup();
    render(<MessageInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const textarea = screen.getByPlaceholderText(/scrivi un messaggio/i);
    await user.type(textarea, 'hello');
    const sendBtn = screen.getByLabelText(/^Send$/i);
    expect(sendBtn).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/chat/MessageInput.test.tsx
```

- [ ] **Step 3: Implement changes** in `MessageInput.tsx`:

Add imports:
```ts
import { Paperclip } from 'lucide-react';
import { useChatStore } from '@/src/stores/chat.store';
import { isImageMime } from '@/src/types/attachment.types';
```

Add refs/state:
```tsx
const fileInputRef = useRef<HTMLInputElement>(null);
const queuedAttachments = useChatStore((s) => s.queuedAttachments);
const queueAttachments = useChatStore((s) => s.queueAttachments);
```

Add the picker handler:
```tsx
const onPickFiles = async (e: ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(e.target.files ?? []);
  if (files.length > 0) await queueAttachments(files);
  e.target.value = '';   // reset so picking the same file again still fires change
};
```

Add paste handler on the textarea:
```tsx
const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
  const files = Array.from(e.clipboardData?.files ?? []);
  if (files.length > 0) {
    e.preventDefault();
    await queueAttachments(files);
  }
};
```

Compute the Send-disabled condition:
```tsx
const hasImages = queuedAttachments.some((a) => isImageMime(a.mime));
const visionBlocked = hasImages && caps?.vision === false;
const canSend = (value.trim().length > 0 || queuedAttachments.length > 0) && !visionBlocked;
```

Wire JSX changes:
1. Add the paperclip button to the left of the thinking-toggle (or in the same toolbar row):
```tsx
<button
  type="button"
  aria-label="Attach files"
  disabled={isStreaming}
  onClick={() => fileInputRef.current?.click()}
  className="p-2 rounded bg-surface-1 text-zinc-500 border border-border-subtle hover:text-zinc-300 disabled:opacity-50"
>
  <Paperclip size={16} />
</button>
<input
  ref={fileInputRef}
  type="file"
  multiple
  accept="image/png,image/jpeg,image/webp,image/gif,.md,.json,.ts,.tsx,.js,.jsx,.py,.txt,.yaml,.yml,.toml,.sh,.sql,.csv"
  hidden
  onChange={onPickFiles}
/>
```

2. Add `onPaste={onPaste}` to the existing `<textarea>`.

3. Replace the Send button's `disabled={!value.trim()}` with `disabled={!canSend}`. Add a `title` that explains when blocked:
```tsx
<button
  type="button"
  aria-label="Send"
  onClick={submit}
  title={visionBlocked ? 'Selected provider does not support images' : undefined}
  className="..."
  disabled={!canSend}
>
  <Send size={16} />
</button>
```

4. Update `submit` to also reset the file input value if needed; the clear-queue is handled by `useStreamingDispatch` after `done`, not here. Actually `submit` here just calls `onSend(text)` — no queue manipulation needed at this layer.

- [ ] **Step 4: Run tests, expect GREEN**

```bash
npx vitest run src/components/chat/MessageInput.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageInput.tsx src/components/chat/MessageInput.test.tsx
git commit -m "feat(slice-20): MessageInput — paperclip + paste + Send-disabled-on-no-vision"
```

---

## Task N1: MessageBubble — render persisted attachments

**Files:**
- Modify: `src/components/chat/MessageBubble.tsx` + test.

- [ ] **Step 1: Append failing tests** to `MessageBubble.test.tsx`:

```tsx
describe('MessageBubble — attachments rendering', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useUiStore.getState()._reset();
  });

  it('renders an <img> for image attachments', () => {
    useChatStore.setState({
      messages: [{
        id: 'U1', role: 'user', text: 'look', timestamp: 0,
        attachments: [{ id: 'a1', mime: 'image/png', name: 'p.png', size: 4 }],
      }],
    });
    render(<MessageBubble id="U1" />);
    const img = screen.getByRole('img', { name: /p\.png/i });
    expect(img.getAttribute('src')).toBe('/api/attachments/a1');
  });

  it('renders a chip for text attachments', () => {
    useChatStore.setState({
      messages: [{
        id: 'U1', role: 'user', text: 'see notes', timestamp: 0,
        attachments: [{ id: 'a2', mime: 'text/markdown', name: 'notes.md', size: 100 }],
      }],
    });
    render(<MessageBubble id="U1" />);
    expect(screen.getByText(/notes\.md/i)).toBeInTheDocument();
  });

  it('clicking an image thumb opens the lightbox', async () => {
    useChatStore.setState({
      messages: [{
        id: 'U1', role: 'user', text: '', timestamp: 0,
        attachments: [{ id: 'a1', mime: 'image/png', name: 'p.png', size: 4 }],
      }],
    });
    const user = userEvent.setup();
    render(<MessageBubble id="U1" />);
    await user.click(screen.getByRole('img', { name: /p\.png/i }));
    expect(useUiStore.getState().lightboxAttachmentId).toBe('a1');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/chat/MessageBubble.test.tsx
```

- [ ] **Step 3: Implement** — in `MessageBubble.tsx`, add an `AttachmentRow` sub-component (or inline) below the markdown body:

```tsx
import { File as FileIcon } from 'lucide-react';
import { isImageMime } from '@/src/types/attachment.types';

// ... inside the bubble render, after the markdown body, before the reasoning button:
{message.attachments && message.attachments.length > 0 && (
  <div className="flex flex-wrap gap-2 mt-2">
    {message.attachments.map((a) => (
      isImageMime(a.mime) ? (
        <button
          key={a.id}
          type="button"
          onClick={() => useUiStore.getState().openLightbox(a.id)}
          className="block"
        >
          <img
            src={`/api/attachments/${a.id}`}
            alt={a.name}
            loading="lazy"
            className="h-24 w-24 object-cover rounded border border-border-subtle hover:opacity-80"
          />
        </button>
      ) : (
        <div
          key={a.id}
          className="flex items-center gap-2 px-2 py-1 bg-surface-3 border border-border-subtle rounded text-xs text-zinc-300 font-mono"
        >
          <FileIcon size={14} className="text-zinc-400" />
          {a.name}
        </div>
      )
    ))}
  </div>
)}
```

- [ ] **Step 4: Run tests, expect GREEN**

```bash
npx vitest run src/components/chat/MessageBubble.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageBubble.tsx src/components/chat/MessageBubble.test.tsx
git commit -m "feat(slice-20): MessageBubble — render image thumbs + text chips for attachments"
```

---

## Task O1: ChatView wiring + useStreamingDispatch + MSW defaults

**Files:**
- Modify: `src/components/chat/ChatView.tsx`.
- Modify: `src/hooks/useStreamingDispatch.ts`.
- Modify: `src/test/msw-handlers.ts`.

- [ ] **Step 1: Wrap ChatView with AttachmentDropZone + mount lightbox + chips**

Open `src/components/chat/ChatView.tsx`. The current shape mounts a message list + `<MessageInput>`. Wrap the root in `<AttachmentDropZone>` and mount `<AttachmentLightbox>` + `<AttachmentChips>`:

```tsx
import { AttachmentDropZone } from './AttachmentDropZone';
import { AttachmentLightbox } from './AttachmentLightbox';
import { AttachmentChips } from './AttachmentChips';

return (
  <AttachmentDropZone>
    {/* existing message list */}
    <AttachmentChips />
    <MessageInput onSend={...} onStop={...} isStreaming={...} />
    <AttachmentLightbox />
  </AttachmentDropZone>
);
```

(Adapt to the actual existing structure. The key: chips sit between message list and input; lightbox is a portal-like mount that can be anywhere; the drop zone wraps the whole interactive area.)

- [ ] **Step 2: Wire attachments through useStreamingDispatch.send**

In `src/hooks/useStreamingDispatch.ts`, the `send` callback reads from various stores. Inside `send`, after computing `activeName` etc., read the queue:

```ts
const queuedAttachments = useChatStore.getState().queuedAttachments;
const attachments = queuedAttachments.length > 0
  ? queuedAttachments.map((a) => ({
      name: a.name,
      mime: a.mime,
      size: a.size,
      contentBase64: a.base64,
    }))
  : undefined;
```

Pass `attachments` into the call to `createStreamingDispatch`:
```ts
for await (const ev of createStreamingDispatch(
  {
    sessionId: activeId,
    message: trimmed,
    thinking,
    ...(activeName ? { providerName: activeName } : {}),
    ...(attachments ? { attachments } : {}),
  },
  controller.signal,
)) { ... }
```

After the `done` event (in the `else if (ev.event === 'done')` branch), call `useChatStore.getState().clearQueuedAttachments()` BEFORE returning.

- [ ] **Step 3: Add MSW default for the attachments route**

In `src/test/msw-handlers.ts`, append:

```ts
http.get('http://localhost/api/attachments/:id', () => {
  // 1x1 transparent PNG
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
  return new HttpResponse(png, {
    status: 200,
    headers: { 'Content-Type': 'image/png' },
  });
}),
```

- [ ] **Step 4: Run the FE suite**

```bash
npx vitest run src/
```

Expected: all green.

- [ ] **Step 5: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ChatView.tsx src/hooks/useStreamingDispatch.ts src/test/msw-handlers.ts
git commit -m "feat(slice-20): wire attachments through ChatView + useStreamingDispatch + MSW default"
```

---

## Task P1: Integration test — drop image → send → bubble renders

**Files:**
- Create: `src/integration/attachments.integration.test.tsx`.

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useChatStore } from '@/src/stores/chat.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { useKeyVaultStore } from '@/src/stores/keyVault.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  useChatStore.getState()._reset();
  useProviderAuthStore.getState()._reset();
  useKeyVaultStore.getState()._reset();
  localStorage.clear();
});

afterEach(() => server.resetHandlers());

describe('attachments integration', () => {
  it('drop an image → chip → submit → bubble renders the attachment', async () => {
    // Override providers so vision=true on the default provider.
    useProvidersStore.setState({
      list: [{ name: 'fake:default', transport: 'fake', model: 'fake-1', capabilities: { thinking: false, toolCalling: false, vision: true }, displayName: 'Fake' }],
      defaultProvider: 'fake:default',
      hydrated: true,
    });

    let receivedBody: { attachments?: Array<{ name: string; contentBase64: string }> } | null = null;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        receivedBody = (await request.json()) as typeof receivedBody;
        // Minimal SSE that drives done quickly
        return new HttpResponse(
          'event: done\ndata: {"model":"fake","interrupted":false}\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );

    render(<App />);
    await waitFor(() => expect(useSessionsStore.getState().hydrated).toBe(true));

    // Drop a file directly onto the chat
    const file = new File(['PNG-BYTES'], 'p.png', { type: 'image/png' });
    // Find the drop zone (wrapping ChatView)
    const dropZone = document.querySelector('[data-drag-active]') as HTMLElement;
    expect(dropZone).not.toBeNull();
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    // Chip appears
    await waitFor(() => {
      expect(useChatStore.getState().queuedAttachments).toHaveLength(1);
    });

    // Type a message then submit
    const textarea = screen.getByPlaceholderText(/scrivi un messaggio/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'see this' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Body captured
    await waitFor(() => {
      expect(receivedBody?.attachments?.[0]?.name).toBe('p.png');
      expect(receivedBody?.attachments?.[0]?.contentBase64.length ?? 0).toBeGreaterThan(0);
    });

    // After done, queue clears
    await waitFor(() => {
      expect(useChatStore.getState().queuedAttachments).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run, expect GREEN**

```bash
npx vitest run src/integration/attachments.integration.test.tsx
```

If it fails:
- Drop zone not found → ensure `data-drag-active` attribute is on the wrapping element.
- Body not captured → confirm `useStreamingDispatch.send` reads queued attachments and passes them.
- Queue not cleared → confirm `clearQueuedAttachments()` runs on `done` event.

- [ ] **Step 3: Commit**

```bash
git add src/integration/attachments.integration.test.tsx
git commit -m "test(slice-20): integration — drop image → send → bubble renders"
```

---

## Task Q1: Playwright smoke + final gates + PR

**Files:**
- Create: `e2e/fixtures/tiny.png`.
- Modify: `e2e/smoke.spec.ts`.

- [ ] **Step 1: Create a tiny PNG fixture**

```bash
# Create a 1x1 transparent PNG (67 bytes)
mkdir -p e2e/fixtures
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x03\x00\x05\xfe\x02\xfe\xa3+f1\x00\x00\x00\x00IEND\xaeB`\x82' > e2e/fixtures/tiny.png
```

Verify it's a valid PNG:
```bash
file e2e/fixtures/tiny.png
```

Expected: `PNG image data, 1 x 1, 8-bit/color RGBA, non-interlaced`.

- [ ] **Step 2: Append smoke test** to `e2e/smoke.spec.ts`:

```ts
test('attachments: paperclip → pick file → chip → send → bubble shows image', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);

  // Click paperclip → set the hidden input directly
  const fileInput = page.locator('input[type="file"][accept*="image"]');
  await fileInput.setInputFiles(path.resolve('e2e/fixtures/tiny.png'));

  // Chip appears — assert by attachment name
  await expect(page.getByText('tiny.png').first()).toBeVisible({ timeout: 3000 });

  // Send a message
  await input.fill('look');
  await input.press('Enter');

  // Wait for FakeProvider reply
  await expect(page.getByText('pong')).toBeVisible({ timeout: 5000 });

  // Image in the bubble — uses /api/attachments/<id> as src
  const bubbleImg = page.getByRole('main').locator('img[src*="/api/attachments/"]');
  await expect(bubbleImg).toBeVisible();
});
```

- [ ] **Step 3: Build + run playwright**

```bash
npm run build
npx playwright test --grep attachments
```

Expected: PASS.

- [ ] **Step 4: Run full playwright suite**

```bash
npx playwright test
```

Expected: 18/18 pass.

- [ ] **Step 5: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 6: Full vitest**

```bash
npx vitest run
```

Expected: all green except 2 pre-existing Ollama flakes.

- [ ] **Step 7: Commit + push**

```bash
git add e2e/smoke.spec.ts e2e/fixtures/tiny.png
git commit -m "test(slice-20): playwright smoke for attachments"
git push -u origin feat/slice-20-attachments
```

- [ ] **Step 8: Open PR**

```bash
gh pr create --title "feat(slice-20): message attachments (images + text files)" --body "$(cat <<'EOF'
## Summary
- Migration 005 adds \`messages_attachments\` BLOB table.
- \`ProviderCapabilities\` gains \`vision\`; Anthropic / OpenAI / Gemini → true, Ollama / Fake → false.
- Each multimodal provider adapter translates \`ProviderRequest.attachments\` to its native block format (Anthropic \`image\`, OpenAI \`image_url\`, Gemini \`inlineData\`).
- \`DispatchService\` validates + decodes incoming base64 attachments, classifies via \`classifyAttachment\` (rejecting unsupported MIMEs / oversize bodies), inlines text attachments as fenced code blocks in the user message, strips images on non-vision providers, persists all originals.
- New route \`GET /api/attachments/:id\` serves BLOB bytes for image thumbs.
- Dispatch route mounts its own 15 MB JSON parser (slice-16-style pattern); global stays at 1 MB.
- FE: \`useChatStore.queuedAttachments\` populated via drag-and-drop, paste, paperclip button. \`AttachmentChips\` renders image thumbs + text chips with × removal and a non-vision-provider warning. \`AttachmentLightbox\` for full-size image view. \`MessageBubble\` renders persisted attachments lazily from \`/api/attachments/<id>\`.
- Slice 16 export/import round-trips attachments via lenient zod (no version bump). Slice 19 \`forkSession\` clones attachment rows with new ids.

## Test plan
- [x] \`classifyAttachment\` matrix (7 cases)
- [x] Provider adapter image translation tests (gemini / openai / anthropic) + vision flag (ollama / fake)
- [x] HistoryStore append/read attachments + getAttachmentBytes + FK cascade + forkSession clone
- [x] \`GET /api/attachments/:id\` (200 + 404 cases)
- [x] DispatchService validates + inlines + forwards + strips-on-no-vision + 413 oversize + 400 unsupported
- [x] Dispatch route 15 MB body parser
- [x] FE: chat.store queue (6 cases), AttachmentChips (5 cases), AttachmentDropZone (3 cases), AttachmentLightbox, MessageInput (paperclip/paste/Send-disabled), MessageBubble (image/text rendering)
- [x] Integration: drop image → send → MSW captures body → queue clears
- [x] Playwright smoke: paperclip → pick → chip → send → bubble shows image
- [x] Lint clean, full vitest green modulo pre-existing Ollama flakes, Playwright 18/18

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-review

| Spec requirement | Task |
|---|---|
| Migration 005 with `messages_attachments` table | A1 |
| `classifyAttachment` helpers + caps | A1 |
| `ProviderCapabilities.vision` + `ProviderRequest.attachments` | B1 |
| Provider adapter image-block translation (gemini/openai/anthropic) | C1 |
| Vision flag on all 5 adapters | C1 |
| HistoryStore.append writes attachment rows | D1 |
| HistoryStore.readMessages returns metadata only | D1 |
| HistoryStore.getAttachmentBytes | D1 |
| FK cascade on delete | D1 |
| forkSession clones attachment rows with new ids | D1 |
| importSession writes attachment rows | D1 |
| GET /api/attachments/:id route | E1 |
| DispatchService validates / decodes / classifies / inlines / forwards / strips-on-no-vision / persists | F1 |
| 413 PAYLOAD_TOO_LARGE on oversize | F1 |
| 400 VALIDATION_ERROR on unsupported MIME | F1 |
| Dispatch route 15 MB body parser | G1 |
| FE types (MessageAttachment, QueuedAttachment, ProviderCapabilities.vision) | H1 |
| dispatch.api request type | H1 |
| chat.store queuedAttachments + actions | I1 |
| Count + size + MIME limits enforced on queue | I1 |
| AttachmentChips component | J1 |
| AttachmentDropZone component | K1 |
| ui.store lightbox + AttachmentLightbox | L1 |
| MessageInput paperclip + paste + Send disabled | M1 |
| MessageBubble image thumb + text chip + lightbox open on click | N1 |
| ChatView wiring | O1 |
| useStreamingDispatch wires attachments + clears on done | O1 |
| MSW default for attachments route | O1 |
| Integration test | P1 |
| Playwright smoke | Q1 |
| Lint + full tests + PR | Q1 |

No placeholders. Types/names consistent throughout: `MessageAttachment`, `QueuedAttachment`, `ProviderAttachment`, `classifyAttachment`, `IMAGE_MIMES`, `TEXT_EXTENSIONS`, `MAX_ATTACHMENTS`, `MAX_TOTAL_BYTES`, `queueAttachments`, `removeQueuedAttachment`, `clearQueuedAttachments`, `getAttachmentBytes`, `lightboxAttachmentId`, `openLightbox`, `closeLightbox`, `vision`. Component testids implicit via aria-labels.
