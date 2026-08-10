-- Control-plane schema for the Cloudflare Worker deployment.
--
-- D1/SQLite stores stable identities, tenancy, authorization, room metadata,
-- asset metadata, and audit records. Realtime room state and its append-only
-- event stream belong to the per-room Durable Object, not this database.
--
-- All ids are application-generated UUID/ULID TEXT values. All timestamps are
-- integer Unix epoch milliseconds supplied by the application.

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

-- Provider rows support passwordless/OAuth/passkey adapters without making an
-- external provider identifier the application's primary user id.
CREATE TABLE identity_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_subject),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Only a one-way digest of the browser session secret is persisted.
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

CREATE INDEX idx_auth_sessions_active_user
  ON auth_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

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

CREATE INDEX idx_workspace_members_user
  ON workspace_members(user_id, workspace_id)
  WHERE status = 'active';

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
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

CREATE INDEX idx_campaigns_workspace_active
  ON campaigns(workspace_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- A campaign role is the durable authorization source for campaign content.
-- Room membership may further restrict it, but never elevate it.
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

CREATE INDEX idx_campaign_members_user_active
  ON campaign_members(user_id, campaign_id)
  WHERE status = 'active';

CREATE INDEX idx_campaign_members_campaign_role
  ON campaign_members(campaign_id, role)
  WHERE status = 'active';

-- R2 objects remain private. This table is the only durable mapping from an
-- application asset to its R2 key; callers should never receive object keys as
-- authorization credentials.
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  campaign_id TEXT,
  created_by_user_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('map', 'token', 'avatar', 'attachment', 'export', 'compendium', 'other')),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'workspace', 'campaign', 'room', 'public')),
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

CREATE INDEX idx_assets_campaign_active
  ON assets(campaign_id, kind, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_assets_workspace_hash
  ON assets(workspace_id, sha256)
  WHERE deleted_at IS NULL;

CREATE TABLE asset_variants (
  asset_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (asset_id, variant),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE upload_intents (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL UNIQUE,
  uploader_user_id TEXT NOT NULL,
  expected_object_key TEXT NOT NULL UNIQUE,
  max_byte_size INTEGER NOT NULL CHECK (max_byte_size > 0),
  allowed_content_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploaded', 'consumed', 'expired', 'cancelled')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (uploader_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_upload_intents_expiry
  ON upload_intents(status, expires_at);

-- A scene is a campaign-owned template. The Room Durable Object keeps the
-- mutable token/fog/initiative state for each live room separately.
CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  sort_order INTEGER NOT NULL DEFAULT 0,
  map_asset_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'dm_only'
    CHECK (visibility IN ('dm_only', 'preview', 'active')),
  template_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (map_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE INDEX idx_scenes_campaign_order
  ON scenes(campaign_id, sort_order, created_at)
  WHERE deleted_at IS NULL;

CREATE TABLE scene_favorites (
  scene_id TEXT NOT NULL,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('monster', 'spell', 'item', 'feat', 'condition')),
  entry_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scene_id, entry_type, entry_id),
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
);

CREATE TABLE campaign_library_entries (
  campaign_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'monster'
    CHECK (entry_type IN ('monster', 'spell', 'item', 'feat', 'condition')),
  display_name TEXT NOT NULL,
  added_by_campaign_member_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, entry_type, entry_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (added_by_campaign_member_id) REFERENCES campaign_members(id) ON DELETE SET NULL
);

-- Characters are user-owned profiles. Binding a character to a party or room
-- is explicit, so a reconnect or a second device cannot create a new identity.
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  avatar_asset_id TEXT,
  color TEXT NOT NULL DEFAULT '#38a169',
  sheet_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'retired', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (avatar_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE INDEX idx_characters_owner_active
  ON characters(owner_user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'deleted')),
  created_by_campaign_member_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_campaign_member_id) REFERENCES campaign_members(id) ON DELETE SET NULL
);

CREATE INDEX idx_parties_campaign_active
  ON parties(campaign_id, name)
  WHERE deleted_at IS NULL;

-- Party leader is a roster-management role only; application authorization
-- must never turn it into campaign/room DM authority.
CREATE TABLE party_members (
  party_id TEXT NOT NULL,
  campaign_member_id TEXT NOT NULL,
  character_id TEXT,
  party_role TEXT NOT NULL DEFAULT 'member'
    CHECK (party_role IN ('leader', 'member')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'removed')),
  joined_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (party_id, campaign_member_id),
  FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_member_id) REFERENCES campaign_members(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL
);

CREATE INDEX idx_party_members_character
  ON party_members(character_id)
  WHERE character_id IS NOT NULL AND status = 'active';

-- A room is an actual tabletop session. Its deterministic Durable Object name
-- is derived from id (for example, "room:<id>"); slug is only a friendly URL,
-- never a secret or authorization grant.
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  created_by_campaign_member_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(slug) BETWEEN 3 AND 120),
  status TEXT NOT NULL DEFAULT 'lobby'
    CHECK (status IN ('lobby', 'live', 'ended', 'archived', 'deleted')),
  active_scene_id TEXT,
  access_epoch INTEGER NOT NULL DEFAULT 1 CHECK (access_epoch >= 1),
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER,
  deleted_at INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_campaign_member_id) REFERENCES campaign_members(id) ON DELETE SET NULL,
  FOREIGN KEY (active_scene_id) REFERENCES scenes(id) ON DELETE SET NULL
);

CREATE INDEX idx_rooms_campaign_status
  ON rooms(campaign_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

-- This is the final authorization boundary for a WebSocket room connection.
-- campaign_member_id is intentionally nullable for room-only guests.
CREATE TABLE room_members (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  campaign_member_id TEXT,
  party_id TEXT,
  character_id TEXT,
  role TEXT NOT NULL
    CHECK (role IN ('host', 'dm', 'assistant_dm', 'player', 'spectator')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended', 'removed')),
  access_epoch INTEGER NOT NULL DEFAULT 1 CHECK (access_epoch >= 1),
  grant_source TEXT NOT NULL
    CHECK (grant_source IN ('manual', 'campaign', 'party', 'invite')),
  joined_at INTEGER NOT NULL,
  removed_at INTEGER,
  UNIQUE (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (campaign_member_id) REFERENCES campaign_members(id) ON DELETE SET NULL,
  FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE SET NULL,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL
);

CREATE INDEX idx_room_members_user_active
  ON room_members(user_id, room_id)
  WHERE status = 'active';

CREATE INDEX idx_room_members_room_role
  ON room_members(room_id, role)
  WHERE status = 'active';

-- Only token hashes are persisted. A random raw invite secret appears exactly
-- once in the generated URL and must be redacted from application logs.
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'campaign', 'room', 'party')),
  scope_id TEXT NOT NULL,
  workspace_id TEXT,
  campaign_id TEXT,
  room_id TEXT,
  party_id TEXT,
  created_by_user_id TEXT NOT NULL,
  grant_role TEXT NOT NULL
    CHECK (grant_role IN ('member', 'dm', 'assistant_dm', 'player', 'spectator')),
  token_hash TEXT NOT NULL UNIQUE,
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  require_approval INTEGER NOT NULL DEFAULT 0 CHECK (require_approval IN (0, 1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  revoked_by_user_id TEXT,
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (max_uses IS NULL OR used_count <= max_uses),
  CHECK (
    (scope_type = 'workspace' AND scope_id = workspace_id AND workspace_id IS NOT NULL
      AND campaign_id IS NULL AND room_id IS NULL AND party_id IS NULL)
    OR
    (scope_type = 'campaign' AND scope_id = campaign_id AND campaign_id IS NOT NULL
      AND workspace_id IS NULL AND room_id IS NULL AND party_id IS NULL)
    OR
    (scope_type = 'room' AND scope_id = room_id AND room_id IS NOT NULL
      AND workspace_id IS NULL AND campaign_id IS NULL AND party_id IS NULL)
    OR
    (scope_type = 'party' AND scope_id = party_id AND party_id IS NOT NULL
      AND workspace_id IS NULL AND campaign_id IS NULL AND room_id IS NULL)
  ),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_invites_scope_active
  ON invites(scope_type, scope_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE invite_redemptions (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  campaign_member_id TEXT,
  room_member_id TEXT,
  redeemed_at INTEGER NOT NULL,
  UNIQUE (invite_id, user_id),
  CHECK (
    workspace_id IS NOT NULL
    OR campaign_member_id IS NOT NULL
    OR room_member_id IS NOT NULL
  ),
  FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
  FOREIGN KEY (campaign_member_id) REFERENCES campaign_members(id) ON DELETE SET NULL,
  FOREIGN KEY (room_member_id) REFERENCES room_members(id) ON DELETE SET NULL
);

CREATE INDEX idx_invite_redemptions_user
  ON invite_redemptions(user_id, redeemed_at DESC);

-- R2 archives contain durable snapshots and compressed room-event ranges
-- emitted by the Room Durable Object's archive outbox.
CREATE TABLE room_archives (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  from_seq INTEGER NOT NULL CHECK (from_seq >= 0),
  to_seq INTEGER NOT NULL CHECK (to_seq >= from_seq),
  snapshot_object_key TEXT,
  events_object_key TEXT,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (room_id, from_seq, to_seq),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX idx_room_archives_room_seq
  ON room_archives(room_id, to_seq DESC);

-- This is a searchable, privacy-conscious audit index. The canonical high
-- frequency room event stream remains inside the Durable Object and is linked
-- here by command_id and the R2 room_archives manifest when exported.
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  campaign_id TEXT,
  room_id TEXT,
  actor_user_id TEXT,
  actor_campaign_member_id TEXT,
  actor_room_member_id TEXT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 160),
  target_type TEXT NOT NULL CHECK (length(target_type) BETWEEN 1 AND 80),
  target_id TEXT,
  command_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT,
  occurred_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_campaign_member_id) REFERENCES campaign_members(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_room_member_id) REFERENCES room_members(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_events_workspace_time
  ON audit_events(workspace_id, occurred_at DESC);

CREATE INDEX idx_audit_events_campaign_time
  ON audit_events(campaign_id, occurred_at DESC)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX idx_audit_events_room_time
  ON audit_events(room_id, occurred_at DESC)
  WHERE room_id IS NOT NULL;

CREATE INDEX idx_audit_events_command
  ON audit_events(command_id)
  WHERE command_id IS NOT NULL;
