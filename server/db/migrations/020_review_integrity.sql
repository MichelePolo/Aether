-- HTTP MCP credentials share the installation vault key.
ALTER TABLE context_mcp_servers ADD COLUMN headers_ciphertext BLOB;
ALTER TABLE context_mcp_servers ADD COLUMN headers_iv BLOB;
ALTER TABLE context_mcp_servers ADD COLUMN headers_auth_tag BLOB;

-- Generated builtins are not rows in context_mcp_servers. Scope policies by
-- concrete server ID, including its normalized workspace root when applicable.
CREATE TABLE builtin_tool_policies (
  server_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  PRIMARY KEY (server_id, tool_name)
);

-- Keep interrupted turns' effective instructions for a faithful resume.
ALTER TABLE messages ADD COLUMN dispatch_context_json TEXT;
