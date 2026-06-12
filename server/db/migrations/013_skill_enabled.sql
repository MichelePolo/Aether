-- Skills can be individually enabled/disabled; only enabled ones are injected
-- into the prompt. Existing skills default to enabled (no behavior change).
ALTER TABLE context_skills ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
