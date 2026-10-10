-- Fresh campaign-only control plane. Legacy room storage is intentionally not imported.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  revoke_reason TEXT,
  CHECK (expires_at > issued_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(slug) BETWEEN 3 AND 80),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'removed')),
  joined_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  module_id TEXT,
  runtime_initialized_at INTEGER,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'deleted')),
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE campaign_members (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('owner', 'dm', 'assistant_dm', 'player', 'spectator')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended', 'removed')),
  permission_epoch INTEGER NOT NULL DEFAULT 1 CHECK (permission_epoch >= 1),
  joined_at INTEGER NOT NULL,
  removed_at INTEGER,
  UNIQUE (campaign_id, user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  campaign_id TEXT,
  created_by_user_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('map', 'token', 'avatar', 'attachment', 'export', 'compendium', 'other')),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'workspace', 'campaign', 'public')),
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

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

CREATE UNIQUE INDEX idx_one_library_per_owner ON workspaces(owner_user_id);
CREATE INDEX idx_campaign_members_user ON campaign_members(user_id,status,campaign_id);
CREATE INDEX idx_assets_campaign ON assets(campaign_id,deleted_at);
CREATE INDEX idx_characters_owner ON campaign_characters(campaign_id,owner_user_id);
CREATE TABLE user_libraries(user_id TEXT PRIMARY KEY REFERENCES users(id),workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id));
CREATE TABLE campaign_character_selections(campaign_id TEXT NOT NULL REFERENCES campaigns(id),user_id TEXT NOT NULL REFERENCES users(id),character_id TEXT NOT NULL REFERENCES campaign_characters(id),selected_at INTEGER NOT NULL,PRIMARY KEY(campaign_id,user_id));
CREATE TABLE invites(
 id TEXT PRIMARY KEY,scope_type TEXT NOT NULL CHECK(scope_type='campaign'),scope_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),created_by_user_id TEXT NOT NULL REFERENCES users(id),
 grant_role TEXT NOT NULL CHECK(grant_role IN ('player','spectator')),token_hash TEXT NOT NULL UNIQUE,
 max_uses INTEGER CHECK(max_uses>0),used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count>=0),
 created_at INTEGER NOT NULL,expires_at INTEGER,revoked_at INTEGER,
 CHECK(scope_id=campaign_id),CHECK(max_uses IS NULL OR used_count<=max_uses)
);
CREATE TABLE invite_redemptions(id TEXT PRIMARY KEY,invite_id TEXT NOT NULL REFERENCES invites(id),user_id TEXT NOT NULL REFERENCES users(id),campaign_member_id TEXT REFERENCES campaign_members(id),redeemed_at INTEGER NOT NULL,UNIQUE(invite_id,user_id));
CREATE TABLE audit_events(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,campaign_id TEXT,actor_user_id TEXT,actor_campaign_member_id TEXT,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT,outcome TEXT NOT NULL,occurred_at INTEGER NOT NULL);
CREATE INDEX idx_audit_campaign ON audit_events(campaign_id,occurred_at);
