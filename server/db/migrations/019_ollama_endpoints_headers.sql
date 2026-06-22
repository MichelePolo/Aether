-- slice: custom headers on ollama endpoints (additive)
ALTER TABLE ollama_endpoints ADD COLUMN headers_ciphertext BLOB;
ALTER TABLE ollama_endpoints ADD COLUMN headers_iv         BLOB;
ALTER TABLE ollama_endpoints ADD COLUMN headers_auth_tag   BLOB;
