-- Material (filesystem) skills track only their toggle state here; existence is
-- the directory on disk under ${AETHER_DATA_DIR}/skills/. Slug = directory name.
-- enabled: injected into the prompt at all; pinned: full SKILL.md inlined (vs
-- progressive disclosure). Material skills default to disabled.
CREATE TABLE skill_state (
  slug    TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  pinned  INTEGER NOT NULL DEFAULT 0
);
