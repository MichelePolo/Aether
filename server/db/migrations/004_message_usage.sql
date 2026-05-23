-- Per-message token usage (slice 19). Both columns NULL for user messages.
ALTER TABLE messages ADD COLUMN tokens_in INTEGER;
ALTER TABLE messages ADD COLUMN tokens_out INTEGER;
