-- Add nullable `category` column to both tool_policies tables (slice 22).
-- Allows per-tool category override (safe/dangerous/external) to be persisted
-- alongside the existing autoApprove flag. Pre-existing rows keep category NULL.

ALTER TABLE context_mcp_tool_policies ADD COLUMN category TEXT;
ALTER TABLE profile_mcp_tool_policies ADD COLUMN category TEXT;

-- Make auto_approve nullable: a row may store only a category override.
-- SQLite cannot drop NOT NULL via ALTER, so we tolerate the constraint and
-- write -1 to mean "unset" — read paths translate -1 back to undefined.
-- (This is a minimal compromise to avoid rebuilding the tables.)
