import { randomToken, sha256Hex, type Session } from './auth';
import { isRoomModerator, type RoomActor, type RoomRole } from './domain';
import { HttpError, nonEmptyText } from './http';

export interface RoomAccess extends RoomActor {
  roomId: string;
  roomSlug: string;
  roomName: string;
  roomStatus: 'lobby' | 'live' | 'ended' | 'archived';
  roomAccessEpoch: number;
  campaignId: string;
  campaignName: string;
  workspaceId: string;
  campaignMemberId: string | null;
  templateId?: string | null;
}

export interface RoomSummary {
  slug: string;
  name: string;
  status: string;
  role: RoomRole;
  campaignName: string;
  updatedAt: number;
}

interface RoomAccessRow {
  room_id: string;
  room_slug: string;
  room_name: string;
  room_status: 'lobby' | 'live' | 'ended' | 'archived';
  room_access_epoch: number;
  campaign_id: string;
  campaign_name: string;
  workspace_id: string;
  room_member_id: string;
  room_role: string;
  member_access_epoch: number;
  campaign_member_id: string | null;
  template_id: string | null;
}

interface AssetRow {
  id: string;
  object_key: string;
  content_type: string;
  byte_size: number;
}

interface InviteRow {
  id: string;
  room_id: string;
  grant_role: string;
  room_slug: string;
}

interface PersistentInviteRow {
  invite_code: string;
}

export interface RoomInvite {
  inviteUrl: string;
  /** Present for the new reusable player invitation, absent for legacy links. */
  inviteCode?: string;
  expiresAt: number | null;
  maxUses: number | null;
}

export async function requireRoomAccess(env: Env, userId: string, roomSlug: string): Promise<RoomAccess> {
  const row = await env.DB.prepare(
    `SELECT r.id AS room_id, r.slug AS room_slug, r.name AS room_name,
            r.status AS room_status, r.access_epoch AS room_access_epoch,
            c.id AS campaign_id, c.name AS campaign_name, c.workspace_id,
            json_extract(c.settings_json, '$.roomTemplateId') AS template_id,
            rm.id AS room_member_id, rm.role AS room_role,
            rm.access_epoch AS member_access_epoch, rm.campaign_member_id
       FROM rooms r
       JOIN campaigns c ON c.id = r.campaign_id AND c.deleted_at IS NULL
       JOIN room_members rm ON rm.room_id = r.id
      WHERE r.slug = ?1
        AND r.deleted_at IS NULL
        AND rm.user_id = ?2
        AND rm.status = 'active'`,
  ).bind(roomSlug, userId).first<RoomAccessRow>();

  if (!row || !isRoomRole(row.room_role)) {
    // Do not distinguish a missing room from a room the caller cannot join.
    throw new HttpError(404, 'ROOM_NOT_FOUND', '找不到该房间，或你尚未加入');
  }
  return {
    roomId: row.room_id,
    roomSlug: row.room_slug,
    roomName: row.room_name,
    roomStatus: row.room_status,
    roomAccessEpoch: row.room_access_epoch,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    workspaceId: row.workspace_id,
    memberId: row.room_member_id,
    userId,
    role: row.room_role,
    accessEpoch: row.member_access_epoch,
    campaignMemberId: row.campaign_member_id,
    templateId: row.template_id,
  };
}

export function requireRoomModerator(access: RoomAccess): void {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人或 DM 可以执行此操作');
}

export function requireRoomHost(access: RoomAccess): void {
  if (access.role !== 'host') throw new HttpError(403, 'FORBIDDEN', '只有房主可以删除房间');
}

export async function listRooms(env: Env, userId: string): Promise<RoomSummary[]> {
  const result = await env.DB.prepare(
    `SELECT r.slug, r.name, r.status, r.updated_at,
            rm.role, c.name AS campaign_name
       FROM room_members rm
       JOIN rooms r ON r.id = rm.room_id AND r.deleted_at IS NULL
       JOIN campaigns c ON c.id = r.campaign_id AND c.deleted_at IS NULL
      WHERE rm.user_id = ?1 AND rm.status = 'active'
      ORDER BY r.updated_at DESC`,
  ).bind(userId).all<{ slug: string; name: string; status: string; updated_at: number; role: string; campaign_name: string }>();

  return result.results.flatMap((row) => isRoomRole(row.role) ? [{
    slug: row.slug,
    name: row.name,
    status: row.status,
    role: row.role,
    campaignName: row.campaign_name,
    updatedAt: row.updated_at,
  }] : []);
}

export async function createRoom(env: Env, session: Session, input: { roomName: string; campaignName?: string; templateId?: string }): Promise<RoomAccess> {
  const roomName = nonEmptyText(input.roomName, '房间名称');
  const campaignName = input.campaignName ? nonEmptyText(input.campaignName, '战役名称') : roomName;
  const now = Date.now();
  const roomSlug = await allocateRoomSlug(env, roomName);
  const workspaceId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const campaignMemberId = crypto.randomUUID();
  const roomId = crypto.randomUUID();
  const roomMemberId = crypto.randomUUID();
  const workspaceSlug = `table-${randomToken(8).toLowerCase()}`;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO workspaces (id, slug, name, owner_user_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
    ).bind(workspaceId, workspaceSlug, `${roomName} 桌团`, session.userId, now),
    env.DB.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES (?1, ?2, 'owner', ?3)`,
    ).bind(workspaceId, session.userId, now),
    env.DB.prepare(
      `INSERT INTO campaigns (id, workspace_id, created_by_user_id, name, settings_json, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
    ).bind(campaignId, workspaceId, session.userId, campaignName, JSON.stringify(input.templateId ? { roomTemplateId: input.templateId } : {}), now),
    env.DB.prepare(
      `INSERT INTO campaign_members (id, campaign_id, user_id, role, status, joined_at)
       VALUES (?1, ?2, ?3, 'owner', 'active', ?4)`,
    ).bind(campaignMemberId, campaignId, session.userId, now),
    env.DB.prepare(
      `INSERT INTO rooms (id, campaign_id, created_by_campaign_member_id, name, slug, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'lobby', ?6, ?6)`,
    ).bind(roomId, campaignId, campaignMemberId, roomName, roomSlug, now),
    env.DB.prepare(
      `INSERT INTO room_members
        (id, room_id, user_id, campaign_member_id, role, status, access_epoch, grant_source, joined_at)
       VALUES (?1, ?2, ?3, ?4, 'host', 'active', 1, 'manual', ?5)`,
    ).bind(roomMemberId, roomId, session.userId, campaignMemberId, now),
  ]);

  return {
    roomId,
    roomSlug,
    roomName,
    roomStatus: 'lobby',
    roomAccessEpoch: 1,
    campaignId,
    campaignName,
    workspaceId,
    memberId: roomMemberId,
    userId: session.userId,
    role: 'host',
    accessEpoch: 1,
    campaignMemberId,
    templateId: input.templateId ?? null,
  };
}

/**
 * Makes a room immediately inaccessible while retaining its audit trail.
 * Campaigns and workspaces are only retired when this was their last room, so
 * the operation remains safe if the data model later exposes multi-room
 * campaigns in the UI.
 */
export async function deleteRoom(env: Env, access: RoomAccess): Promise<void> {
  requireRoomHost(access);
  const now = Date.now();
  const assetPrefix = roomAssetPrefix(access);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE rooms
          SET status = 'deleted', access_epoch = access_epoch + 1,
              updated_at = ?1, ended_at = COALESCE(ended_at, ?1), deleted_at = ?1
        WHERE id = ?2 AND deleted_at IS NULL`,
    ).bind(now, access.roomId),
    env.DB.prepare(
      `UPDATE room_members
          SET status = 'removed', access_epoch = access_epoch + 1, removed_at = COALESCE(removed_at, ?1)
        WHERE room_id = ?2 AND status != 'removed'`,
    ).bind(now, access.roomId),
    env.DB.prepare(
      `UPDATE invites
          SET revoked_at = COALESCE(revoked_at, ?1), revoked_by_user_id = COALESCE(revoked_by_user_id, ?2)
        WHERE room_id = ?3 AND revoked_at IS NULL`,
    ).bind(now, access.userId, access.roomId),
    env.DB.prepare(
      `UPDATE assets SET deleted_at = ?1
        WHERE workspace_id = ?2 AND campaign_id = ?3
          AND substr(object_key, 1, length(?4)) = ?4 AND deleted_at IS NULL`,
    ).bind(now, access.workspaceId, access.campaignId, assetPrefix),
    env.DB.prepare(
      `UPDATE campaigns
          SET status = 'deleted', updated_at = ?1, deleted_at = ?1
        WHERE id = ?2 AND deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM rooms WHERE campaign_id = ?2 AND deleted_at IS NULL)`,
    ).bind(now, access.campaignId),
    env.DB.prepare(
      `UPDATE campaign_members
          SET status = 'removed', permission_epoch = permission_epoch + 1, removed_at = COALESCE(removed_at, ?1)
        WHERE campaign_id = ?2 AND status != 'removed'
          AND NOT EXISTS (SELECT 1 FROM campaigns WHERE id = ?2 AND deleted_at IS NULL)`,
    ).bind(now, access.campaignId),
    env.DB.prepare(
      `UPDATE workspaces
          SET status = 'deleted', updated_at = ?1, deleted_at = ?1
        WHERE id = ?2 AND deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM campaigns WHERE workspace_id = ?2 AND deleted_at IS NULL)`,
    ).bind(now, access.workspaceId),
    env.DB.prepare(
      `UPDATE workspace_members
          SET status = 'removed', removed_at = COALESCE(removed_at, ?1)
        WHERE workspace_id = ?2 AND status != 'removed'
          AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id = ?2 AND deleted_at IS NULL)`,
    ).bind(now, access.workspaceId),
  ]);
  if (results[0]?.meta.changes !== 1) throw new HttpError(409, 'ROOM_ALREADY_DELETED', '房间已被删除');
}

/** Delete private room images after the authorization records have gone away. */
export async function deleteRoomAssets(env: Env, access: RoomAccess): Promise<void> {
  const prefix = roomAssetPrefix(access);
  let cursor: string | undefined;
  do {
    const page = await env.ROOM_ASSETS.list({ prefix, ...(cursor ? { cursor } : {}) });
    if (page.objects.length > 0) await env.ROOM_ASSETS.delete(page.objects.map(object => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** Close active clients and erase the per-room realtime database. */
export async function deleteRoomLiveState(env: Env, access: RoomAccess): Promise<void> {
  const response = await callRoom(env, access, 'DELETE', '/destroy');
  if (!response.ok) throw new Error(`Room state cleanup failed with ${response.status}`);
}

export async function createRoomInvite(env: Env, access: RoomAccess, input: { role: unknown; maxUses?: unknown }): Promise<RoomInvite> {
  requireRoomModerator(access);
  const role = input.role === 'spectator' ? 'spectator' : input.role === 'player' || input.role === undefined ? 'player' : null;
  if (!role) throw new HttpError(400, 'INVALID_INPUT', '邀请角色只能是玩家或旁观者');

  // The normal player invitation is intentionally durable: every moderator
  // receives the same code for this room, and any number of players can
  // redeem it over time. Supplying maxUses preserves the old limited-link
  // capability for API callers that explicitly need it.
  if (input.maxUses === undefined) return getOrCreateReusableRoomInvite(env, access, role);

  const maxUses = boundedInteger(input.maxUses, 1, 50, '邀请次数');
  const rawToken = randomToken(32);
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1_000;
  await env.DB.prepare(
    `INSERT INTO invites
      (id, scope_type, scope_id, room_id, created_by_user_id, grant_role, token_hash, max_uses, created_at, expires_at)
     VALUES (?1, 'room', ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(crypto.randomUUID(), access.roomId, access.userId, role, await sha256Hex(rawToken), maxUses, now, expiresAt).run();

  return { inviteUrl: `/r/${encodeURIComponent(access.roomSlug)}#invite=${rawToken}`, expiresAt, maxUses };
}

async function getOrCreateReusableRoomInvite(env: Env, access: RoomAccess, role: 'player' | 'spectator'): Promise<RoomInvite> {
  const existing = await reusableRoomInvite(env, access.roomId, role);
  if (existing) return reusableInviteResponse(access.roomSlug, existing.invite_code);

  // The code has 80 bits of entropy and excludes visually ambiguous symbols.
  // INSERT OR IGNORE also makes concurrent moderator clicks converge on the
  // single per-room code guaranteed by the partial unique index.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = randomInviteCode();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO invites
        (id, scope_type, scope_id, room_id, created_by_user_id, grant_role, token_hash, invite_code, max_uses, created_at, expires_at)
       VALUES (?1, 'room', ?2, ?2, ?3, ?4, ?5, ?6, NULL, ?7, NULL)`,
    ).bind(
      crypto.randomUUID(), access.roomId, access.userId, role,
      await sha256Hex(inviteCode), inviteCode, now,
    ).run();

    const persisted = await reusableRoomInvite(env, access.roomId, role);
    if (persisted) return reusableInviteResponse(access.roomSlug, persisted.invite_code);
  }
  throw new HttpError(503, 'INVITE_UNAVAILABLE', '暂时无法生成邀请码，请重试');
}

async function reusableRoomInvite(env: Env, roomId: string, role: 'player' | 'spectator'): Promise<PersistentInviteRow | null> {
  return env.DB.prepare(
    `SELECT invite_code
       FROM invites
      WHERE scope_type = 'room' AND scope_id = ?1 AND grant_role = ?2
        AND invite_code IS NOT NULL
        AND max_uses IS NULL AND expires_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
  ).bind(roomId, role).first<PersistentInviteRow>();
}

function reusableInviteResponse(roomSlug: string, inviteCode: string): RoomInvite {
  return {
    inviteCode,
    inviteUrl: `/r/${encodeURIComponent(roomSlug)}#invite=${encodeURIComponent(inviteCode)}`,
    expiresAt: null,
    maxUses: null,
  };
}

export async function redeemRoomInvite(env: Env, session: Session, token: string): Promise<{ roomSlug: string }> {
  const now = Date.now();
  const inviteCode = normalizeInviteCode(token);
  const invite = await env.DB.prepare(
    `SELECT i.id, i.room_id, i.grant_role, r.slug AS room_slug
       FROM invites i JOIN rooms r ON r.id = i.room_id AND r.deleted_at IS NULL
      WHERE (i.token_hash = ?1 OR i.invite_code = ?2 COLLATE NOCASE)
        AND i.scope_type = 'room'
        AND i.revoked_at IS NULL
        AND (i.expires_at IS NULL OR i.expires_at > ?3)
        AND (i.max_uses IS NULL OR i.used_count < i.max_uses)`,
  ).bind(await sha256Hex(token), inviteCode, now).first<InviteRow>();
  if (!invite || !isInviteRole(invite.grant_role)) throw new HttpError(404, 'INVITE_NOT_FOUND', '邀请无效、已过期或已用完');

  const prior = await env.DB.prepare(
    `SELECT ir.room_member_id, r.slug AS room_slug
       FROM invite_redemptions ir JOIN rooms r ON r.id = ?2
      WHERE ir.invite_id = ?1 AND ir.user_id = ?3`,
  ).bind(invite.id, invite.room_id, session.userId).first<{ room_member_id: string; room_slug: string }>();
  if (prior) return { roomSlug: prior.room_slug };

  const used = await env.DB.prepare(
    `UPDATE invites SET used_count = used_count + 1
      WHERE id = ?1 AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?2)
        AND (max_uses IS NULL OR used_count < max_uses)`,
  ).bind(invite.id, now).run();
  if (used.meta.changes !== 1) throw new HttpError(409, 'INVITE_EXHAUSTED', '邀请刚刚被其他人用完');

  const existingMember = await env.DB.prepare(
    'SELECT id FROM room_members WHERE room_id = ?1 AND user_id = ?2',
  ).bind(invite.room_id, session.userId).first<{ id: string }>();
  const memberId = existingMember?.id ?? crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO room_members
          (id, room_id, user_id, role, status, access_epoch, grant_source, joined_at)
         VALUES (?1, ?2, ?3, ?4, 'active', 1, 'invite', ?5)
         ON CONFLICT(room_id, user_id) DO NOTHING`,
      ).bind(memberId, invite.room_id, session.userId, invite.grant_role, now),
      env.DB.prepare(
        `INSERT INTO invite_redemptions (id, invite_id, user_id, room_member_id, redeemed_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(crypto.randomUUID(), invite.id, session.userId, memberId, now),
    ]);
  } catch (error) {
    // A double click from the same browser can race. The unique redemption row
    // remains authoritative; restore the optimistically consumed counter only
    // for that harmless duplicate path.
    const raced = await env.DB.prepare(
      'SELECT 1 AS present FROM invite_redemptions WHERE invite_id = ?1 AND user_id = ?2',
    ).bind(invite.id, session.userId).first<{ present: number }>();
    if (!raced) throw error;
    await env.DB.prepare('UPDATE invites SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END WHERE id = ?1')
      .bind(invite.id).run();
  }
  return { roomSlug: invite.room_slug };
}

export async function createAsset(env: Env, access: RoomAccess, file: File, kindValue: FormDataEntryValue | null): Promise<{ id: string; url: string }> {
  const kind = typeof kindValue === 'string' && ['map', 'token', 'avatar', 'attachment'].includes(kindValue) ? kindValue : 'map';
  const playerAvatarUpload = access.role === 'player' && (kind === 'token' || kind === 'avatar');
  if (!isRoomModerator(access.role) && !playerAvatarUpload) {
    throw new HttpError(403, 'FORBIDDEN', '只有主持人可上传此类素材');
  }
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
  if (!allowedTypes.has(file.type)) throw new HttpError(415, 'UNSUPPORTED_MEDIA', '仅支持 JPEG、PNG、WebP 或 AVIF 图片');
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '图片必须小于 10 MiB');
  const bytes = await file.arrayBuffer();
  if (!looksLikeImage(bytes, file.type)) throw new HttpError(415, 'UNSUPPORTED_MEDIA', '文件内容不是声明的图片格式');

  const id = crypto.randomUUID();
  const objectKey = `${roomAssetPrefix(access)}${id}/source`;
  const now = Date.now();
  await env.ROOM_ASSETS.put(objectKey, bytes, { httpMetadata: { contentType: file.type } });
  try {
    await env.DB.prepare(
      `INSERT INTO assets
        (id, workspace_id, campaign_id, created_by_user_id, kind, visibility, object_key, content_type, byte_size, sha256, metadata_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'room', ?6, ?7, ?8, ?9, ?10, ?11)`,
    ).bind(
      id,
      access.workspaceId,
      access.campaignId,
      access.userId,
      kind,
      objectKey,
      file.type,
      file.size,
      await sha256Hex(bytes),
      JSON.stringify({ filename: file.name.slice(0, 200) }),
      now,
    ).run();
  } catch (error) {
    await env.ROOM_ASSETS.delete(objectKey);
    throw error;
  }
  return { id, url: `/api/rooms/${encodeURIComponent(access.roomSlug)}/assets/${id}` };
}

function roomAssetPrefix(access: Pick<RoomAccess, 'workspaceId' | 'roomId'>): string {
  return `v1/workspaces/${access.workspaceId}/rooms/${access.roomId}/assets/`;
}

export async function getAsset(env: Env, access: RoomAccess, assetId: string): Promise<{ metadata: AssetRow; object: R2ObjectBody }> {
  const metadata = await env.DB.prepare(
    `SELECT id, object_key, content_type, byte_size
       FROM assets
      WHERE id = ?1 AND workspace_id = ?2 AND campaign_id = ?3 AND deleted_at IS NULL`,
  ).bind(assetId, access.workspaceId, access.campaignId).first<AssetRow>();
  if (!metadata) throw new HttpError(404, 'ASSET_NOT_FOUND', '找不到素材');
  const object = await env.ROOM_ASSETS.get(metadata.object_key);
  if (!object) throw new HttpError(404, 'ASSET_NOT_FOUND', '找不到素材');
  return { metadata, object };
}

export function internalRoomHeaders(access: RoomAccess): Headers {
  const headers = new Headers();
  headers.set('x-dnd-internal-request', '1');
  headers.set('x-dnd-room-id', access.roomId);
  headers.set('x-dnd-user-id', access.userId);
  headers.set('x-dnd-member-id', access.memberId);
  headers.set('x-dnd-room-role', access.role);
  headers.set('x-dnd-access-epoch', String(access.accessEpoch));
  return headers;
}

export async function initializeRoom(env: Env, access: RoomAccess): Promise<void> {
  const headers = internalRoomHeaders(access);
  headers.set('content-type', 'application/json');
  const response = await env.ROOMS.getByName(`room:${access.roomId}`).fetch(
    new Request('https://room.internal/initialize', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        roomName: access.roomName,
        campaignName: access.campaignName,
        roomSlug: access.roomSlug,
        templateId: access.templateId ?? null,
      }),
    }),
  );
  if (!response.ok) throw new HttpError(502, 'ROOM_UNAVAILABLE', '房间服务暂时不可用');
}

export async function callRoom(env: Env, access: RoomAccess, method: string, path: string, payload?: unknown): Promise<Response> {
  const headers = internalRoomHeaders(access);
  let body: string | undefined;
  if (payload !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(payload);
  }
  return env.ROOMS.getByName(`room:${access.roomId}`).fetch(
    new Request(`https://room.internal${path}`, { method, headers, body }),
  );
}

export async function forwardRoomWebSocket(env: Env, access: RoomAccess, request: Request): Promise<Response> {
  const headers = new Headers(request.headers);
  internalRoomHeaders(access).forEach((value, key) => headers.set(key, value));
  return env.ROOMS.getByName(`room:${access.roomId}`).fetch(
    new Request('https://room.internal/connect', { method: 'GET', headers }),
  );
}

function isRoomRole(value: string): value is RoomRole {
  return value === 'host' || value === 'dm' || value === 'assistant_dm' || value === 'player' || value === 'spectator';
}

function isInviteRole(value: string): value is 'player' | 'spectator' {
  return value === 'player' || value === 'spectator';
}

const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const INVITE_CODE_LENGTH = 16;

function randomInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  const compact = [...bytes].map(byte => INVITE_CODE_ALPHABET[byte & 31]).join('');
  return compact.match(/.{1,4}/g)?.join('-') ?? compact;
}

function normalizeInviteCode(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\s-]/gu, '');
  if (!new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`, 'u').test(compact)) return null;
  return compact.match(/.{1,4}/g)?.join('-') ?? compact;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new HttpError(400, 'INVALID_INPUT', `${label}必须是 ${minimum} 到 ${maximum} 的整数`);
  }
  return value;
}

async function allocateRoomSlug(env: Env, name: string): Promise<string> {
  const base = slugify(name) || 'adventure';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slug = `${base.slice(0, 72)}-${randomToken(5).toLowerCase()}`;
    const existing = await env.DB.prepare('SELECT 1 AS present FROM rooms WHERE slug = ?1').bind(slug).first<{ present: number }>();
    if (!existing) return slug;
  }
  throw new HttpError(503, 'SLUG_UNAVAILABLE', '暂时无法生成房间地址，请重试');
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function looksLikeImage(buffer: ArrayBuffer, type: string): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 16));
  const startsWith = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (type === 'image/jpeg') return startsWith(0xff, 0xd8, 0xff);
  if (type === 'image/png') return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (type === 'image/webp') return startsWith(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (type === 'image/avif') return String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
  return false;
}
