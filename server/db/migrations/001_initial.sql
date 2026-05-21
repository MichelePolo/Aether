-- Context (singleton + child tables)

CREATE TABLE context (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  system_instruction TEXT NOT NULL DEFAULT ''
);

CREATE TABLE context_skills (
  position INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE context_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('online','offline')),
  position INTEGER NOT NULL
);

CREATE TABLE context_mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('stdio','mock','http')),
  command TEXT,
  args TEXT,
  env TEXT,
  url TEXT,
  status TEXT NOT NULL
);

CREATE TABLE context_mcp_tool_policies (
  server_id TEXT NOT NULL REFERENCES context_mcp_servers(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  auto_approve INTEGER NOT NULL,
  PRIMARY KEY (server_id, tool_name)
);

-- Sessions / messages / reasoning

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  provider_name TEXT
);

CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','model')),
  content TEXT NOT NULL,
  model TEXT,
  interrupted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  retryable INTEGER,
  created_at INTEGER NOT NULL,
  position INTEGER NOT NULL
);

CREATE INDEX idx_messages_session ON messages(session_id, position);

CREATE TABLE reasoning_steps (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens INTEGER,
  duration_ms INTEGER,
  sub_agent TEXT,
  timestamp INTEGER NOT NULL,
  position INTEGER NOT NULL
);

CREATE INDEX idx_reasoning_message ON reasoning_steps(message_id, position);

CREATE TABLE tool_call_traces (
  id TEXT PRIMARY KEY,
  reasoning_step_id TEXT NOT NULL REFERENCES reasoning_steps(id) ON DELETE CASCADE,
  qualified_name TEXT NOT NULL,
  args TEXT NOT NULL,
  result TEXT,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  progress_note TEXT
);

-- Profiles

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  system_instruction TEXT NOT NULL DEFAULT '',
  thinking_enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE profile_skills (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (profile_id, position)
);

CREATE TABLE profile_tools (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (profile_id, tool_id)
);

CREATE TABLE profile_mcp_servers (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,
  command TEXT,
  args TEXT,
  env TEXT,
  url TEXT,
  status TEXT NOT NULL,
  PRIMARY KEY (profile_id, server_id)
);

CREATE TABLE profile_mcp_tool_policies (
  profile_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  auto_approve INTEGER NOT NULL,
  PRIMARY KEY (profile_id, server_id, tool_name),
  FOREIGN KEY (profile_id, server_id)
    REFERENCES profile_mcp_servers(profile_id, server_id)
    ON DELETE CASCADE
);

-- Sub-agents

CREATE TABLE subagents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system_instruction TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE subagent_skills (
  subagent_id TEXT NOT NULL REFERENCES subagents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (subagent_id, position)
);

CREATE TABLE subagent_tools (
  subagent_id TEXT NOT NULL REFERENCES subagents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (subagent_id, position)
);
