-- Per-step LLM selection for swarms: a step may pin a provider (transport:model
-- registry key); a sub-agent may carry a default model. Both nullable = inherit /
-- no default, so existing rows keep the single-default-provider behavior.
ALTER TABLE swarm_steps ADD COLUMN provider_name TEXT;
ALTER TABLE subagents   ADD COLUMN model TEXT;
