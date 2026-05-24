-- Workspaces (slice 23). N rows, one per saved project folder. Unique on rootPath.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_workspaces_root_path ON workspaces(root_path);

-- Sessions get an optional FK pointing at a workspace. ON DELETE SET NULL so
-- removing a workspace doesn't cascade-delete its sessions.
ALTER TABLE sessions ADD COLUMN workspace_id TEXT
  REFERENCES workspaces(id) ON DELETE SET NULL;
