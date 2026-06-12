-- Add 'git' to the builtin MCP transports (slice 28). SQLite cannot ALTER a CHECK
-- constraint, so rebuild the table preserving existing rows, then seed 'git'.
CREATE TABLE builtin_mcp_state_new (
  transport TEXT PRIMARY KEY CHECK (transport IN ('filesystem','terminal','git')),
  enabled INTEGER NOT NULL DEFAULT 0,
  fs_root TEXT
);
INSERT INTO builtin_mcp_state_new (transport, enabled, fs_root)
  SELECT transport, enabled, fs_root FROM builtin_mcp_state;
DROP TABLE builtin_mcp_state;
ALTER TABLE builtin_mcp_state_new RENAME TO builtin_mcp_state;
INSERT INTO builtin_mcp_state (transport, enabled, fs_root) VALUES ('git', 0, NULL);
