-- Reusable module templates, room campaign saves, and campaign-isolated PCs.
PRAGMA foreign_keys = ON;

CREATE TABLE campaign_modules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  template_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_campaign_modules_workspace_active
  ON campaign_modules(workspace_id, updated_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE campaigns ADD COLUMN module_id TEXT;

-- One room is a stable gathering place and may contain many playthrough saves.
CREATE TABLE room_campaigns (
  room_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  last_played_at INTEGER,
  PRIMARY KEY (room_id, campaign_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE INDEX idx_room_campaigns_recent
  ON room_campaigns(room_id, last_played_at DESC, added_at DESC);

-- A PC belongs to exactly one campaign save. The same user creates a separate
-- character when starting a different campaign, while old PCs remain resumable.
CREATE TABLE campaign_characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  avatar_url TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#38a169',
  sheet_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'retired', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_campaign_characters_owner
  ON campaign_characters(campaign_id, owner_user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE room_character_selections (
  room_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  selected_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, campaign_id, user_id),
  FOREIGN KEY (room_id, campaign_id) REFERENCES room_campaigns(room_id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES campaign_characters(id) ON DELETE CASCADE
);

-- Backfill every existing workspace with a reusable blank module and preserve
-- every current campaign as a resumable save in its room.
INSERT INTO campaign_modules
  (id, workspace_id, created_by_user_id, name, description, template_json, created_at, updated_at)
SELECT 'blank-' || id, id, owner_user_id, '空白冒险', '从空白场景开始的通用模组',
       '{"firstSceneName":"起始场景"}', created_at, updated_at
  FROM workspaces;

UPDATE campaigns
   SET module_id = 'blank-' || workspace_id
 WHERE module_id IS NULL;

INSERT INTO room_campaigns (room_id, campaign_id, added_at, last_played_at)
SELECT id, campaign_id, created_at, updated_at FROM rooms;
