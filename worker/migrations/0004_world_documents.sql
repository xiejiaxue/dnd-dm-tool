-- FVTT-inspired campaign documents for actors, journals, map notes and macros.
-- Durable Object room snapshots remain untouched; this migration is additive.

PRAGMA foreign_keys = ON;

CREATE TABLE document_folders (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('actor', 'journal', 'macro')),
  parent_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  sort_order INTEGER NOT NULL DEFAULT 0,
  flags_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (campaign_id, document_type, parent_id, name),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES document_folders(id) ON DELETE CASCADE
);

CREATE INDEX idx_document_folders_campaign_type
  ON document_folders(campaign_id, document_type, parent_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE TABLE actors (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('character', 'npc', 'monster')),
  folder_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT NOT NULL DEFAULT '',
  system_json TEXT NOT NULL DEFAULT '{}',
  prototype_token_json TEXT NOT NULL DEFAULT '{}',
  ownership_json TEXT NOT NULL DEFAULT '{"default":"none","users":{}}',
  flags_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES document_folders(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_actors_campaign_directory
  ON actors(campaign_id, folder_id, sort_order, name)
  WHERE deleted_at IS NULL;

-- Claim is deliberately separate from Actor ownership. It answers who is
-- currently impersonating an Actor in one room; ownership answers who may
-- inspect or edit the durable Actor document.
CREATE TABLE actor_claims (
  room_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  room_member_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  claimed_at INTEGER NOT NULL,
  released_at INTEGER,
  PRIMARY KEY (room_id, actor_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (room_member_id) REFERENCES room_members(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_actor_claims_one_primary_per_user
  ON actor_claims(room_id, user_id)
  WHERE status = 'active';

CREATE INDEX idx_actor_claims_active_actor
  ON actor_claims(actor_id, room_id)
  WHERE status = 'active';

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  folder_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  ownership_json TEXT NOT NULL DEFAULT '{"default":"none","users":{}}',
  flags_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES document_folders(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_journal_entries_campaign_directory
  ON journal_entries(campaign_id, folder_id, sort_order, name)
  WHERE deleted_at IS NULL;

CREATE TABLE journal_pages (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  page_type TEXT NOT NULL CHECK (page_type IN ('markdown', 'image', 'pdf', 'handout')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  text_content TEXT NOT NULL DEFAULT '',
  asset_url TEXT,
  flags_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (journal_id) REFERENCES journal_entries(id) ON DELETE CASCADE
);

CREATE INDEX idx_journal_pages_entry_order
  ON journal_pages(journal_id, sort_order, created_at)
  WHERE deleted_at IS NULL;

-- Scene IDs live in a Room Durable Object during the compatibility period, so
-- they cannot be foreign keys to the D1 scene-template table yet.
CREATE TABLE scene_notes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  page_id TEXT,
  x REAL NOT NULL,
  y REAL NOT NULL,
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 160),
  icon TEXT NOT NULL DEFAULT 'pin' CHECK (length(icon) BETWEEN 1 AND 80),
  visibility TEXT NOT NULL DEFAULT 'inherit' CHECK (visibility IN ('inherit', 'gm', 'all')),
  flags_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (journal_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES journal_pages(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_scene_notes_room_scene
  ON scene_notes(room_id, scene_id, created_at)
  WHERE deleted_at IS NULL;

CREATE TABLE macros (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  folder_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  command_json TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  ownership_json TEXT NOT NULL DEFAULT '{"default":"none","users":{}}',
  flags_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES document_folders(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_macros_campaign_directory
  ON macros(campaign_id, folder_id, sort_order, name)
  WHERE deleted_at IS NULL;

CREATE TABLE macro_hotbar_bindings (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 10),
  macro_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id, slot),
  UNIQUE (room_id, user_id, macro_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (macro_id) REFERENCES macros(id) ON DELETE CASCADE
);
