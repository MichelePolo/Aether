CREATE TABLE swarms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE swarm_steps (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  subagent_name TEXT NOT NULL,
  prompt_template TEXT NOT NULL DEFAULT '',
  pause_after INTEGER NOT NULL DEFAULT 0,
  UNIQUE (swarm_id, position)
);

CREATE INDEX idx_swarm_steps_swarm ON swarm_steps(swarm_id, position);
