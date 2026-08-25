-- A reusable room invite needs a retrievable, human-entered credential. The
-- code remains high entropy (80 bits) and is unique across all active and
-- historical invites; old hash-only one-time links remain valid.
ALTER TABLE invites ADD COLUMN invite_code TEXT COLLATE NOCASE;

CREATE UNIQUE INDEX idx_invites_invite_code
  ON invites(invite_code)
  WHERE invite_code IS NOT NULL;

-- A room has at most one active reusable code per granted role. This lets a
-- moderator request it again later without issuing a different credential.
CREATE UNIQUE INDEX idx_invites_room_reusable_role
  ON invites(scope_id, grant_role)
  WHERE scope_type = 'room'
    AND invite_code IS NOT NULL
    AND max_uses IS NULL
    AND expires_at IS NULL
    AND revoked_at IS NULL;
