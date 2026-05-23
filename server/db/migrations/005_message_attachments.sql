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
