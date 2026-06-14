CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cadence_json TEXT NOT NULL,
  target_json TEXT NOT NULL,
  autonomy TEXT NOT NULL DEFAULT 'safe' CHECK (autonomy IN ('safe','trusted')),
  provider_name TEXT,
  workspace_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  session_id TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running','success','error','rejected')),
  error TEXT
);

CREATE INDEX idx_schedule_runs_schedule ON schedule_runs(schedule_id, started_at DESC);
