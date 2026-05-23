-- Built-in MCP toggles (slice 21). 2 pre-seeded rows: filesystem + terminal.
CREATE TABLE builtin_mcp_state (
  transport TEXT PRIMARY KEY CHECK (transport IN ('filesystem','terminal')),
  enabled INTEGER NOT NULL DEFAULT 0,
  fs_root TEXT
);

INSERT INTO builtin_mcp_state (transport, enabled, fs_root) VALUES ('filesystem', 0, NULL);
INSERT INTO builtin_mcp_state (transport, enabled, fs_root) VALUES ('terminal', 0, NULL);
