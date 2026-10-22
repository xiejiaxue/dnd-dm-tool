-- Face-to-face tabletop tools: reusable Items, roll tables, playlists,
-- encounter presets, durable action history and per-user world settings.

PRAGMA foreign_keys = ON;

CREATE TABLE tabletop_documents (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  document_type TEXT NOT NULL
    CHECK (document_type IN ('item', 'roll_table', 'playlist', 'encounter_preset')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  folder_path TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL DEFAULT '{}',
  ownership_json TEXT NOT NULL DEFAULT '{"default":"none","users":{}}',
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_tabletop_documents_directory
  ON tabletop_documents(campaign_id, document_type, folder_path, sort_order, name)
  WHERE deleted_at IS NULL;

CREATE TABLE room_action_log (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  scene_id TEXT,
  actor_id TEXT,
  target_token_ids_json TEXT NOT NULL DEFAULT '[]',
  action_type TEXT NOT NULL
    CHECK (action_type IN ('roll', 'damage', 'healing', 'effect', 'encounter', 'handout', 'system')),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 240),
  formula TEXT,
  total REAL,
  details_json TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all', 'gm')),
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_room_action_log_recent
  ON room_action_log(room_id, created_at DESC);

CREATE TABLE tabletop_user_settings (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

