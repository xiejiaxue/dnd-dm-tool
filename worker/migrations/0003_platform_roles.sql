-- Platform roles are separate from room membership. The owner may inspect
-- every room without being promoted to that room's host or DM role.
CREATE TABLE platform_roles (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner')),
  granted_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

