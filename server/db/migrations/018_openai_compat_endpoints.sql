-- slice: openai-compat vLLM provider
CREATE TABLE openai_compat_endpoints (
  id                 TEXT PRIMARY KEY,
  label              TEXT NOT NULL UNIQUE,
  base_url           TEXT NOT NULL,
  model              TEXT,
  headers_ciphertext BLOB,
  headers_iv         BLOB,
  headers_auth_tag   BLOB,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
