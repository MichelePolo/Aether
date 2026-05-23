# Aether Slice 20 — Message attachments (images + text files) (design spec)

**Date:** 2026-05-23
**Branch:** `feat/slice-20-attachments`
**Roadmap entry:** docs/superpowers/roadmap.md → "Slice 20 — Message attachments"

## Goal

Let users drag/drop/paste/pick image and text files into a chat message. Images flow through provider-native multimodal blocks; text files are inlined as fenced code blocks so they work on every provider. Persist all attachments to SQLite so sessions round-trip cleanly, including through slice 16's export/import and slice 19's fork.

## Scope decisions

| Decision | Choice |
|---|---|
| Text-file behavior | Server inlines as fenced code blocks in the user message before dispatch. Provider-agnostic. |
| Storage | SQLite BLOB in new `messages_attachments` table. ON DELETE CASCADE from `messages`. |
| Input surfaces | Drag-and-drop on `<ChatView>` + paste in `<MessageInput>` + paperclip button. All funnel into one store action. |
| Unsupported vision provider | FE disables Send + shows inline warning. Server strips images defensively. |
| MIME whitelist | Images: PNG / JPEG / WebP / GIF. Text: `text/*` MIME + a whitelist of common code/data extensions when MIME is generic. |
| Image fetching at render time | `GET /api/attachments/:id` separate route; metadata in the history payload only. |
| Per-message limits | 5 attachments max, 10 MB decoded total. |
| Wire format | Base64 over JSON. Dispatch route mounts own `express.json({ limit: '15mb' })`. |
| New `ProviderCapabilities.vision` flag | Anthropic/OpenAI/Gemini `true`; Ollama/Fake `false`. |

## Data shapes

```ts
// server/domain/dispatch/providers/provider.types.ts (extension)
export interface ProviderCapabilities {
  thinking: boolean;
  toolCalling: boolean;
  vision: boolean;
}

export interface ProviderAttachment {
  name: string;
  mime: string;        // image/png, image/jpeg, image/webp, image/gif
  bytes: Buffer;
}

export interface ProviderRequest {
  // ...existing fields...
  attachments?: ProviderAttachment[];  // images only; texts are already inlined upstream
}
```

```ts
// server/domain/history/history.types.ts (extension)
export interface MessageAttachment {
  id: string;
  mime: string;
  name: string;
  size: number;
  contentBase64?: string;  // present only on write/import paths
}

export interface Message {
  // ...existing fields...
  attachments?: MessageAttachment[];   // present on user messages that carried any; otherwise undefined
}
```

```sql
-- server/db/migrations/005_message_attachments.sql
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

```ts
// Dispatch wire — extension to DispatchRequestSchema
export const DispatchAttachmentSchema = z.object({
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(127),
  size: z.number().int().nonnegative(),
  contentBase64: z.string(),
});

export const DispatchRequestSchema = z.object({
  // ...existing...
  attachments: z.array(DispatchAttachmentSchema).max(5).optional(),
});
```

### MIME whitelist

```ts
// server/domain/dispatch/attachment.types.ts
export const IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
]);

// Whitelist used when the browser hands us empty / application/octet-stream
// MIME (common for code files like .ts).
export const TEXT_EXTENSIONS = new Set([
  'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'py', 'yaml', 'yml',
  'toml', 'sh', 'sql', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'html', 'css', 'csv', 'env', 'gitignore',
]);

export function classifyAttachment(name: string, mime: string): 'image' | 'text' | null {
  if (IMAGE_MIMES.has(mime)) return 'image';
  if (mime.startsWith('text/')) return 'text';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return null;
}

export const MAX_ATTACHMENTS = 5;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;   // 10 MB decoded
```

### Limits enforcement

| Limit | Value | Where |
|---|---|---|
| Max attachments per message | 5 | FE on queue, server via zod `max(5)` |
| Max total bytes per dispatch | 10 MB decoded | FE on queue, server via sum check after base64 decode → 413 PAYLOAD_TOO_LARGE |
| Wire size (15 MB raw JSON) | `express.json({ limit: '15mb' })` on the dispatch route | Server |
| Single-file name length | 255 chars | zod |

## Architecture

### Server

- **Migration 005** creates `messages_attachments`.
- **`attachment.types.ts`** (new) — pure helpers: `IMAGE_MIMES`, `TEXT_EXTENSIONS`, `classifyAttachment`, `MAX_ATTACHMENTS`, `MAX_TOTAL_BYTES`.
- **`provider.types.ts`** — extends capabilities + request as above. Adapters declare `vision` in their constructor:
  - `gemini`, `openai`, `anthropic` → `true`. Each `stream()` translates `req.attachments` into the adapter's native image-block format on the *user* message.
  - `ollama`, `fake` → `false`. (Ollama's vision support is per-model; this slice ships text-only.)
- **`history.types.ts`** — adds `MessageAttachment`, `Message.attachments?`.
- **`history.store.ts`**:
  - `append(sessionId, message)` decodes each `contentBase64` into a Buffer and writes one row per attachment (id from `randomUUID`, position from array index, FK to the new message).
  - `readMessages` SELECTs attachments metadata (id, mime, name, size, position) and groups by message; **never** loads BLOBs in history reads.
  - New `getAttachmentBytes(id): Promise<{ mime, name, content: Buffer } | null>` for the new route.
  - `forkSession` (slice 19): adds a clause that copies attachment rows with new ids tying to the cloned message; content bytes are preserved verbatim.
  - `delete` is unchanged — FK cascade handles it.
- **`server/routes/attachments.routes.ts`** (new) — single `GET /:id` returns BLOB with `Content-Type: <mime>`, `Content-Disposition: inline`. 404 if not found.
- **`server/app.ts`** — mount `app.use('/api/attachments', createAttachmentsRoutes(historyStore))` near the other routes.
- **`dispatch.service.ts`**:
  - Parse + validate `attachments` via the extended `DispatchRequestSchema`.
  - Per-attachment: `classifyAttachment` → `null` is `ValidationError('Unsupported MIME')`. Decode base64; sum byte length; > 10 MB → throw `PAYLOAD_TOO_LARGE` (error mapped to 413).
  - Partition into text vs image.
  - Text attachments → append to `req.message` as ` ```<filename>\n<utf8>\n``` ` blocks, in queue order, with a single blank line between them and any blank line between them and the original text.
  - Persist the user message via `historyStore.append({ ..., attachments: <both text + image originals> })`.
  - Resolve provider. If `provider.capabilities.vision === false`, drop image attachments (don't error — FE prevents it; server is defense-in-depth).
  - Pass remaining image attachments to the provider via `ProviderRequest.attachments`.
- **`dispatch.routes.ts`** — mount its OWN `express.json({ limit: '15mb' })` middleware on the POST handler (the global stays at 1 MB).

### Frontend

- **Types** — `MessageAttachment` and a FE-only `QueuedAttachment = MessageAttachment + { dataUri }` in `src/types/attachment.types.ts`.
- **`src/types/provider.types.ts`** — mirror `vision`.
- **`src/stores/chat.store.ts`**:
  - State: `queuedAttachments: QueuedAttachment[]`, `queueReading: boolean`.
  - Actions:
    - `queueAttachments(files: File[])`: validates count + size + MIME; reads each file via `FileReader.readAsDataURL`; on success pushes a row with `{ id, name, mime, size, base64, dataUri }`. Sets per-error message on `chat.store.error`.
    - `removeQueuedAttachment(id)`.
    - `clearQueuedAttachments()`.
- **`src/hooks/useStreamingDispatch.ts`** — `send()` reads `queuedAttachments` snapshot, builds `{ name, mime, size, contentBase64 }` array, passes to `createStreamingDispatch`. Clears queue after `done`.
- **`src/lib/api/dispatch.api.ts`** — request type gains `attachments?`.
- **`src/components/chat/AttachmentChips.tsx`** (new) — renders the queue above the textarea. Image entries: 56×56 thumbs with `<img src={dataUri}>` (in-memory). Text entries: chip with filename + size + icon. Each chip has an `×` remove button. Bottom warning row when any image is queued and `caps.vision === false`.
- **`src/components/chat/AttachmentDropZone.tsx`** (new) — wraps `<ChatView>` children; intercepts `dragenter`/`dragleave`/`dragover`/`drop`; on drop, calls `queueAttachments(Array.from(e.dataTransfer.files))`. Visual highlight via `data-drag-active`.
- **`src/components/chat/AttachmentLightbox.tsx`** (new) — modal showing a clicked image at full size. Reads from `useUiStore.lightboxAttachmentId`. Closes on Escape / outside-click.
- **`src/stores/ui.store.ts`** — adds `lightboxAttachmentId: string | null` + `openLightbox(id)` / `closeLightbox()`.
- **`src/components/chat/MessageInput.tsx`**:
  - Paperclip button to the left of the textarea; opens a hidden `<input type="file" multiple accept="image/*,.md,.json,.ts,.tsx,.js,.jsx,.py,.txt,.yaml,.yml,.toml,.sh,.sql,.csv">`.
  - `onPaste` handler reads `e.clipboardData.files`; if non-empty, queue them.
  - Send button disabled when (no text AND queue empty) OR (queue has images AND `caps.vision === false`).
- **`src/components/chat/MessageBubble.tsx`**:
  - Below the markdown body, iterate `message.attachments`. For images: clickable thumb `<img src="/api/attachments/<id>" loading="lazy" />` (opens lightbox). For text files: a chip with filename + size.
- **`src/components/chat/ChatView.tsx`** — wraps children with `<AttachmentDropZone>` and mounts `<AttachmentLightbox />`.

### MSW

- `src/test/msw-handlers.ts` — default for `GET /api/attachments/:id` returns a tiny PNG (hardcoded 1×1 transparent PNG bytes).

## Data flow

### Queue
1. User drops files / pastes / picks → `queueAttachments(files)`.
2. Per file: `FileReader.readAsDataURL` (async). Wait `Promise.all`. Split off `data:<mime>;base64,` prefix.
3. Validate count / size / MIME. Errors set `chat.store.error`; per-file errors include the filename.
4. Push valid entries onto `queuedAttachments`. `<AttachmentChips>` re-renders.

### Send
1. `MessageInput` submit → `useStreamingDispatch.send(text)`.
2. Build request body with `attachments` array of `{ name, mime, size, contentBase64 }`. Empty array omitted (so old clients/tests don't see the field at all).
3. POST `/api/ai/dispatch` (15 MB JSON parser on the route).
4. Server `DispatchService.handle`:
   1. zod validates.
   2. `classifyAttachment` per entry; decode base64; sum check.
   3. Text → inline into `req.message`. Image → keep as `ProviderAttachment[]`.
   4. `historyStore.append` writes user message + all attachment rows.
   5. Resolve provider. If no vision, drop images. Otherwise pass through `ProviderRequest.attachments`.
   6. Provider adapter shapes images into its native block format and dispatches.
5. FE: on `done`, `clearQueuedAttachments()`.

### Re-render history
1. `historyApi.fetchById(id)` returns messages including `attachments` metadata (no bytes).
2. `<MessageBubble>` renders thumbs via `<img src="/api/attachments/<id>">` for images, chips for text.
3. Click thumb → `useUiStore.openLightbox(id)` → `<AttachmentLightbox>` fetches the same URL at full size.

### Attachment route
1. `GET /api/attachments/:id` → `historyStore.getAttachmentBytes(id)` → 404 or `{ mime, name, content }`.
2. `res.setHeader('Content-Type', mime); res.setHeader('Content-Disposition', 'inline'); res.send(content)`.

## Error handling

| Scenario | Server | FE surface |
|---|---|---|
| Unknown MIME | 400 VALIDATION_ERROR "Unsupported MIME: …" | `chat.store.error` banner |
| Invalid base64 | 400 VALIDATION_ERROR | Banner |
| Decoded total > 10 MB | 413 PAYLOAD_TOO_LARGE | "Attachments too large (max 10 MB total)" |
| Wire body > 15 MB raw | 413 entity.too.large | Same banner |
| Provider has no vision + image attached | Server silently strips images and dispatches the text. FE already disables Send so this is rarely reached. | None |
| `GET /api/attachments/:id` unknown id | 404 NOT_FOUND | Browser shows broken-image icon on the bubble — acceptable; only reachable by tampering. |
| Drop > 5 files on FE | Doesn't reach server. | Banner |
| Drop > 10 MB on FE | Doesn't reach server. | Banner |
| File read fails (corrupt File handle) | Doesn't reach server. | Per-file error in banner: "Failed to read <name>". |

## Slice integration

- **Slice 16 (export/import):** the existing `exportEnvelopeSchema` parses optional inner fields leniently. Adding `attachments` (with `contentBase64` populated for export) round-trips through with **no version bump** (still `version: 1`). Import path: `HistoryStore.importSession` already iterates messages — it gains the same `attachments` write path as `append`.
- **Slice 17 (provider auth):** no interaction. The pane shows transport status only.
- **Slice 18 (key vault):** no interaction.
- **Slice 19 (fork + token meter):** `forkSession` copies attachment rows. Token counts on assistant messages are unaffected — attachments live on user messages.

## Testing strategy

### Server (vitest)
- `attachment.test.ts` — `classifyAttachment` matrix (~8 cases).
- `provider.types.ts` adapter tests — assert image attachments translate to the right native block format for Gemini / OpenAI / Anthropic. Ollama + Fake → capabilities `vision: false`.
- `history.store.test.ts` — append + read round-trip (metadata only); `getAttachmentBytes`; FK cascade on delete; `forkSession` clones attachments with new ids.
- `attachments.routes.test.ts` — GET 200 with correct Content-Type; GET 404 for unknown.
- `dispatch.service.test.ts` — text inlined as fenced block; image forwarded via `ProviderRequest.attachments`; image stripped on `vision:false` provider; oversize → 413; unsupported MIME → 400.
- `dispatch.routes.test.ts` — 15 MB JSON parser accepts large bodies; small smoke for attachment-bearing request.

### Frontend (vitest + RTL + MSW)
- `chat.store.test.ts` — `queueAttachments` happy path; count/size/MIME limits; `removeQueuedAttachment`; `clearQueuedAttachments`.
- `AttachmentChips.test.tsx` — image thumbs + text chips render; × removes; vision-warning row.
- `AttachmentDropZone.test.tsx` — drop dispatches queueAttachments; drag-over sets `data-drag-active`.
- `MessageInput.test.tsx` — paperclip opens picker; paste dispatches; Send disabled with reason on vision-less provider.
- `MessageBubble.test.tsx` — image thumb renders with `src="/api/attachments/<id>"`; text chip renders.
- `AttachmentLightbox.test.tsx` — opens when id set; closes on Escape / outside-click.
- `useStreamingDispatch.test.ts` — `send` includes attachments in body; clears queue on done.

### Integration (vitest + RTL + MSW)
- `src/integration/attachments.integration.test.tsx` — drop a synthetic PNG → chip → submit → MSW captures body → bubble renders attachment.

### Playwright (`e2e/smoke.spec.ts`)
- One smoke: paperclip → `setInputFiles` with `e2e/fixtures/tiny.png` → chip → send → wait `pong` → assert `<img>` with `src` matching `/api/attachments/` is visible.

## Out of scope

- Audio / video attachments.
- File previews beyond images (no PDF rendering).
- Edit a message and change its attachments (forking + re-typing is the path).
- Per-message attachment limits beyond the dispatch-time cap (no session-wide quota).
- Per-model vision capability matrix (Ollama vision-capable models are not auto-detected — they're text-only this slice).
- Compression / re-encoding (we store the original bytes).

## Acceptance criteria

1. Drag-and-drop, paste, and paperclip-click all add files to the chat compose queue, capped at 5 attachments and 10 MB total.
2. Unsupported MIMEs are rejected up-front with a clear error banner; the queue is unchanged for valid files dropped in the same batch.
3. Sending a message with text-file attachments delivers those files to the model as fenced code blocks in the user message; the model sees plain text.
4. Sending a message with image attachments to a vision-capable provider delivers them as the provider's native multimodal blocks.
5. Sending with images queued on a non-vision provider is blocked at the FE Send button with a tooltip; server-side defense strips images if it ever reaches dispatch.
6. Sent attachments persist; reopening the session re-renders thumbs via `GET /api/attachments/:id`. Clicking an image thumb opens a lightbox.
7. Forking a session preserves attachment bytes through new attachment ids tied to the cloned messages.
8. The slice 16 export/import flow round-trips attachments without a schema version bump.
9. Lint clean, full vitest green (modulo pre-existing Ollama flakes), Playwright smoke green.
