-- Per-category breakpoints policy (slice 22). Singleton-style: exactly 3 rows.
CREATE TABLE breakpoint_policy (
  category TEXT PRIMARY KEY CHECK (category IN ('safe','dangerous','external')),
  mode TEXT NOT NULL CHECK (mode IN ('auto','gate'))
);

INSERT INTO breakpoint_policy (category, mode) VALUES ('safe', 'auto');
INSERT INTO breakpoint_policy (category, mode) VALUES ('dangerous', 'gate');
INSERT INTO breakpoint_policy (category, mode) VALUES ('external', 'gate');
