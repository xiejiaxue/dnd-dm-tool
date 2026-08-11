PRAGMA foreign_keys = ON;

-- Foundry-style campaign journals/handouts. Content remains scoped to one
-- campaign save; visibility is enforced in every read query.
CREATE TABLE campaign_journals (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  content TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'dm'
    CHECK (visibility IN ('dm', 'players')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_campaign_journals_visible
  ON campaign_journals(campaign_id, visibility, updated_at DESC)
  WHERE deleted_at IS NULL;

-- Owned compendium references are lightweight copies attached to a campaign
-- character sheet. Canonical book data stays once in private R2 and is shared
-- by every campaign through the entry_type + entry_id reference.
CREATE TABLE campaign_character_entries (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 0 AND 9999),
  prepared INTEGER NOT NULL DEFAULT 0 CHECK (prepared IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (character_id, entry_type, entry_id),
  FOREIGN KEY (character_id) REFERENCES campaign_characters(id) ON DELETE CASCADE
);

CREATE INDEX idx_campaign_character_entries_character
  ON campaign_character_entries(character_id, entry_type, display_name);
