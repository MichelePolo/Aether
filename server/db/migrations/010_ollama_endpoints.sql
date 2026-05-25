-- Slice 27: multiple remote Ollama endpoints, configurable at runtime.
-- The local endpoint is NOT stored here; it is synthetic, derived from OLLAMA_HOST.
CREATE TABLE ollama_endpoints (
  id               TEXT PRIMARY KEY,
  label            TEXT NOT NULL UNIQUE,
  base_url         TEXT NOT NULL,
  token_ciphertext BLOB,
  token_iv         BLOB,
  token_auth_tag   BLOB,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
