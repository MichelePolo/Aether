-- Encrypted provider API keys (AES-256-GCM, machine-derived key).
CREATE TABLE provider_keys (
  transport TEXT PRIMARY KEY CHECK (transport IN ('anthropic','openai','gemini')),
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
