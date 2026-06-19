-- Per-swarm default workspace + per-step override, so a swarm's builtin tools
-- root at the intended workspace (NULL = no rooting, prior behavior).
ALTER TABLE swarms ADD COLUMN workspace_id TEXT;
ALTER TABLE swarm_steps ADD COLUMN workspace_id TEXT;
