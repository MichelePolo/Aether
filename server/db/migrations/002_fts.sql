CREATE VIRTUAL TABLE messages_fts USING fts5(
  message_id UNINDEXED,
  session_id UNINDEXED,
  role UNINDEXED,
  content,
  tokenize='unicode61'
);

INSERT INTO messages_fts (message_id, session_id, role, content)
  SELECT id, session_id, role, content FROM messages;
