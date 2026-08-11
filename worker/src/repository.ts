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
  campaignConfigured: boolean;
}

export interface CampaignModuleSummary {
  id: string;
  name: string;
  description: string;
}

export interface CampaignSaveSummary {
  id: string;
  name: string;
  moduleId: string | null;
  moduleName: string;
  updatedAt: number;
  lastPlayedAt: number | null;
  active: boolean;
}

export interface CampaignCharacterSummary {
  id: string;
  campaignId: string;
  name: string;
  color: string;
  avatarUrl: string;
  maxHp: number;
  updatedAt: number;
}

export interface CharacterCompendiumEntry {
  id: string;
  type: string;
  entryId: string;
  name: string;
  source: string;
  quantity: number;
  prepared: boolean;
}

export interface CampaignJournalSummary {
  id: string;
  title: string;
  content: string;
  visibility: 'dm' | 'players';
  updatedAt: number;
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
  campaign_settings_json: string;
  character_id: string | null;
  character_name: string | null;
  character_color: string | null;
  character_avatar: string | null;
  character_sheet_json: string | null;
  display_name: string;
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

export async function requireRoomAccess(env: Env, userId: string, roomSlug: string): Promise<RoomAccess> {
  const row = await env.DB.prepare(
    `SELECT r.id AS room_id, r.slug AS room_slug, r.name AS room_name,
            r.status AS room_status, r.access_epoch AS room_access_epoch,
            c.id AS campaign_id, c.name AS campaign_name, c.workspace_id,
            c.settings_json AS campaign_settings_json,
            rm.id AS room_member_id, rm.role AS room_role,
            rm.access_epoch AS member_access_epoch, rm.campaign_member_id,
            cc.id AS character_id, cc.name AS character_name, cc.color AS character_color,
            cc.avatar_url AS character_avatar, cc.sheet_json AS character_sheet_json,
            u.display_name
       FROM rooms r
       JOIN campaigns c ON c.id = r.campaign_id AND c.deleted_at IS NULL
       JOIN room_members rm ON rm.room_id = r.id
       JOIN users u ON u.id = rm.user_id
       LEFT JOIN room_character_selections rcs
         ON rcs.room_id = r.id AND rcs.campaign_id = c.id AND rcs.user_id = rm.user_id
       LEFT JOIN campaign_characters cc
         ON cc.id = rcs.character_id AND cc.campaign_id = c.id AND cc.deleted_at IS NULL
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
    campaignConfigured: campaignIsConfigured(row.campaign_settings_json),
    displayName: row.character_name ?? row.display_name,
    ...(row.character_id ? {
      characterId: row.character_id,
      characterName: row.character_name ?? '冒险者',
      characterColor: row.character_color ?? '#38a169',
      characterAvatar: row.character_avatar ?? '',
      characterMaxHp: characterMaxHp(row.character_sheet_json),
    } : {}),
  };
}

export function requireRoomModerator(access: RoomAccess): void {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人或 DM 可以执行此操作');
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

export async function createRoom(env: Env, session: Session, input: { roomName: string; campaignName?: string }): Promise<RoomAccess> {
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
  const moduleId = `blank-${workspaceId}`;

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
      `INSERT INTO campaign_modules
        (id, workspace_id, created_by_user_id, name, description, template_json, created_at, updated_at)
       VALUES (?1, ?2, ?3, '空白冒险', '从空白场景开始的通用模组', '{"firstSceneName":"起始场景"}', ?4, ?4)`,
    ).bind(moduleId, workspaceId, session.userId, now),
    env.DB.prepare(
      `INSERT INTO campaigns (id, workspace_id, created_by_user_id, name, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
    ).bind(campaignId, workspaceId, session.userId, campaignName, now),
    env.DB.prepare(
      `UPDATE campaigns SET module_id = ?2, settings_json = '{"configured":false}' WHERE id = ?1`,
    ).bind(campaignId, moduleId),
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
    env.DB.prepare(
      `INSERT INTO room_campaigns (room_id, campaign_id, added_at, last_played_at) VALUES (?1, ?2, ?3, ?3)`,
    ).bind(roomId, campaignId, now),
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
    campaignConfigured: false,
  };
}

export async function listCampaignModules(env: Env, access: RoomAccess): Promise<CampaignModuleSummary[]> {
  const result = await env.DB.prepare(
    `SELECT id, name, description FROM campaign_modules
      WHERE workspace_id = ?1 AND status = 'active' AND deleted_at IS NULL
      ORDER BY created_at ASC`,
  ).bind(access.workspaceId).all<{ id: string; name: string; description: string }>();
  return result.results;
}

export async function listCampaignSaves(env: Env, access: RoomAccess): Promise<CampaignSaveSummary[]> {
  const result = await env.DB.prepare(
    `SELECT c.id, c.name, c.module_id, c.updated_at, rc.last_played_at,
            COALESCE(m.name, '未知模组') AS module_name
       FROM room_campaigns rc
       JOIN campaigns c ON c.id = rc.campaign_id AND c.deleted_at IS NULL
       LEFT JOIN campaign_modules m ON m.id = c.module_id AND m.deleted_at IS NULL
      WHERE rc.room_id = ?1
        AND COALESCE(json_extract(c.settings_json, '$.configured'), 1) != 0
      ORDER BY COALESCE(rc.last_played_at, rc.added_at) DESC`,
  ).bind(access.roomId).all<{ id: string; name: string; module_id: string | null; module_name: string; updated_at: number; last_played_at: number | null }>();
  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    moduleId: row.module_id,
    moduleName: row.module_name,
    updatedAt: row.updated_at,
    lastPlayedAt: row.last_played_at,
    active: row.id === access.campaignId && access.campaignConfigured,
  }));
}

export async function createCampaignSave(
  env: Env,
  access: RoomAccess,
  input: { name: string; moduleId: string },
): Promise<CampaignSaveSummary> {
  requireRoomModerator(access);
  const name = nonEmptyText(input.name, '战役名称');
  const moduleRow = await env.DB.prepare(
    `SELECT id, name FROM campaign_modules WHERE id = ?1 AND workspace_id = ?2 AND status = 'active' AND deleted_at IS NULL`,
  ).bind(input.moduleId, access.workspaceId).first<{ id: string; name: string }>();
  if (!moduleRow) throw new HttpError(404, 'MODULE_NOT_FOUND', '找不到该模组');
  const id = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO campaigns
        (id, workspace_id, created_by_user_id, name, settings_json, module_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, '{"configured":true}', ?5, ?6, ?6)`,
    ).bind(id, access.workspaceId, access.userId, name, moduleRow.id, now),
    env.DB.prepare(
      `INSERT INTO campaign_members (id, campaign_id, user_id, role, status, joined_at)
       VALUES (?1, ?2, ?3, 'owner', 'active', ?4)`,
    ).bind(memberId, id, access.userId, now),
    env.DB.prepare(
      `INSERT INTO room_campaigns (room_id, campaign_id, added_at, last_played_at) VALUES (?1, ?2, ?3, ?3)`,
    ).bind(access.roomId, id, now),
  ]);
  return { id, name, moduleId: moduleRow.id, moduleName: moduleRow.name, updatedAt: now, lastPlayedAt: now, active: false };
}

export async function selectCampaignSave(
  env: Env,
  access: RoomAccess,
  campaignId: string,
): Promise<{ campaign: CampaignSaveSummary; firstSceneName: string }> {
  requireRoomModerator(access);
  const row = await env.DB.prepare(
    `SELECT c.id, c.name, c.module_id, c.updated_at, m.name AS module_name, m.template_json
       FROM room_campaigns rc
       JOIN campaigns c ON c.id = rc.campaign_id AND c.deleted_at IS NULL
       LEFT JOIN campaign_modules m ON m.id = c.module_id
      WHERE rc.room_id = ?1 AND c.id = ?2
        AND COALESCE(json_extract(c.settings_json, '$.configured'), 1) != 0`,
  ).bind(access.roomId, campaignId).first<{ id: string; name: string; module_id: string | null; updated_at: number; module_name: string | null; template_json: string | null }>();
  if (!row) throw new HttpError(404, 'CAMPAIGN_NOT_FOUND', '找不到该战役存档');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE rooms SET campaign_id = ?2, updated_at = ?3 WHERE id = ?1').bind(access.roomId, row.id, now),
    env.DB.prepare('UPDATE room_campaigns SET last_played_at = ?3 WHERE room_id = ?1 AND campaign_id = ?2').bind(access.roomId, row.id, now),
  ]);
  return {
    campaign: { id: row.id, name: row.name, moduleId: row.module_id, moduleName: row.module_name ?? '未知模组', updatedAt: row.updated_at, lastPlayedAt: now, active: true },
    firstSceneName: moduleFirstScene(row.template_json),
  };
}

export async function listCampaignCharacters(env: Env, access: RoomAccess, campaignId: string): Promise<CampaignCharacterSummary[]> {
  await requireRoomCampaign(env, access, campaignId);
  const result = await env.DB.prepare(
    `SELECT id, campaign_id, name, color, avatar_url, sheet_json, updated_at
       FROM campaign_characters
      WHERE campaign_id = ?1 AND owner_user_id = ?2 AND status = 'active' AND deleted_at IS NULL
      ORDER BY updated_at DESC`,
  ).bind(campaignId, access.userId).all<{ id: string; campaign_id: string; name: string; color: string; avatar_url: string; sheet_json: string; updated_at: number }>();
  return result.results.map(characterSummary);
}

export async function createCampaignCharacter(
  env: Env,
  access: RoomAccess,
  input: { campaignId: string; name: string; color?: string; maxHp?: number },
): Promise<CampaignCharacterSummary> {
  await requireRoomCampaign(env, access, input.campaignId);
  const name = nonEmptyText(input.name, '角色名称');
  const color = /^#[0-9a-f]{6}$/iu.test(input.color ?? '') ? input.color! : '#38a169';
  const maxHp = Math.max(1, Math.min(9999, Number.isFinite(input.maxHp) ? Math.round(input.maxHp!) : 10));
  const id = crypto.randomUUID();
  const now = Date.now();
  const sheet = JSON.stringify({ maxHp });
  await env.DB.prepare(
    `INSERT INTO campaign_characters
      (id, campaign_id, owner_user_id, name, color, sheet_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
  ).bind(id, input.campaignId, access.userId, name, color, sheet, now).run();
  return { id, campaignId: input.campaignId, name, color, avatarUrl: '', maxHp, updatedAt: now };
}

export async function selectCampaignCharacter(env: Env, access: RoomAccess, campaignId: string, characterId: string): Promise<CampaignCharacterSummary> {
  await requireRoomCampaign(env, access, campaignId);
  const row = await env.DB.prepare(
    `SELECT id, campaign_id, name, color, avatar_url, sheet_json, updated_at
       FROM campaign_characters
      WHERE id = ?1 AND campaign_id = ?2 AND owner_user_id = ?3 AND status = 'active' AND deleted_at IS NULL`,
  ).bind(characterId, campaignId, access.userId).first<{ id: string; campaign_id: string; name: string; color: string; avatar_url: string; sheet_json: string; updated_at: number }>();
  if (!row) throw new HttpError(404, 'CHARACTER_NOT_FOUND', '找不到该角色');
  await env.DB.prepare(
    `INSERT INTO room_character_selections (room_id, campaign_id, user_id, character_id, selected_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(room_id, campaign_id, user_id)
     DO UPDATE SET character_id = excluded.character_id, selected_at = excluded.selected_at`,
  ).bind(access.roomId, campaignId, access.userId, characterId, Date.now()).run();
  return characterSummary(row);
}

export async function getSelectedCharacterSheet(env: Env, access: RoomAccess): Promise<{ character: CampaignCharacterSummary; entries: CharacterCompendiumEntry[] }> {
  if (!access.characterId) throw new HttpError(404, 'CHARACTER_NOT_SELECTED', '当前战役尚未选择角色');
  const character = await env.DB.prepare(
    `SELECT id, campaign_id, name, color, avatar_url, sheet_json, updated_at
       FROM campaign_characters
      WHERE id = ?1 AND campaign_id = ?2 AND owner_user_id = ?3 AND deleted_at IS NULL`,
  ).bind(access.characterId, access.campaignId, access.userId).first<{ id: string; campaign_id: string; name: string; color: string; avatar_url: string; sheet_json: string; updated_at: number }>();
  if (!character) throw new HttpError(404, 'CHARACTER_NOT_FOUND', '找不到当前角色');
  const entries = await env.DB.prepare(
    `SELECT id, entry_type, entry_id, display_name, source, quantity, prepared
       FROM campaign_character_entries WHERE character_id = ?1
      ORDER BY entry_type, display_name COLLATE NOCASE`,
  ).bind(access.characterId).all<{ id: string; entry_type: string; entry_id: string; display_name: string; source: string; quantity: number; prepared: number }>();
  return {
    character: characterSummary(character),
    entries: entries.results.map((entry) => ({
      id: entry.id, type: entry.entry_type, entryId: entry.entry_id, name: entry.display_name,
      source: entry.source, quantity: entry.quantity, prepared: entry.prepared === 1,
    })),
  };
}

export async function addSelectedCharacterEntry(
  env: Env,
  access: RoomAccess,
  input: { type: string; entryId: string; name: string; source?: string },
): Promise<CharacterCompendiumEntry> {
  if (!access.characterId || access.role !== 'player') throw new HttpError(403, 'FORBIDDEN', '请先选择玩家角色');
  const type = compendiumEntryType(input.type);
  const entryId = nonEmptyText(input.entryId, '资料 ID', 300);
  const name = nonEmptyText(input.name, '资料名称', 160);
  const source = (input.source ?? '').trim().slice(0, 64);
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO campaign_character_entries
      (id, character_id, entry_type, entry_id, display_name, source, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT(character_id, entry_type, entry_id)
     DO UPDATE SET display_name = excluded.display_name, source = excluded.source, updated_at = excluded.updated_at`,
  ).bind(id, access.characterId, type, entryId, name, source, now).run();
  const row = await env.DB.prepare(
    `SELECT id, entry_type, entry_id, display_name, source, quantity, prepared
       FROM campaign_character_entries WHERE character_id = ?1 AND entry_type = ?2 AND entry_id = ?3`,
  ).bind(access.characterId, type, entryId).first<{ id: string; entry_type: string; entry_id: string; display_name: string; source: string; quantity: number; prepared: number }>();
  if (!row) throw new HttpError(500, 'INTERNAL', '无法保存角色资料');
  return { id: row.id, type: row.entry_type, entryId: row.entry_id, name: row.display_name, source: row.source, quantity: row.quantity, prepared: row.prepared === 1 };
}

export async function removeSelectedCharacterEntry(env: Env, access: RoomAccess, entryId: string): Promise<void> {
  if (!access.characterId || access.role !== 'player') throw new HttpError(403, 'FORBIDDEN', '请先选择玩家角色');
  const result = await env.DB.prepare(
    'DELETE FROM campaign_character_entries WHERE id = ?1 AND character_id = ?2',
  ).bind(entryId, access.characterId).run();
  if (result.meta.changes !== 1) throw new HttpError(404, 'ENTRY_NOT_FOUND', '找不到角色资料');
}

export async function listCampaignJournals(env: Env, access: RoomAccess): Promise<CampaignJournalSummary[]> {
  const moderator = isRoomModerator(access.role);
  const result = await env.DB.prepare(
    `SELECT id, title, content, visibility, updated_at FROM campaign_journals
      WHERE campaign_id = ?1 AND deleted_at IS NULL
        AND (?2 = 1 OR visibility = 'players')
      ORDER BY updated_at DESC`,
  ).bind(access.campaignId, moderator ? 1 : 0).all<{ id: string; title: string; content: string; visibility: 'dm' | 'players'; updated_at: number }>();
  return result.results.map((entry) => ({ id: entry.id, title: entry.title, content: entry.content, visibility: entry.visibility, updatedAt: entry.updated_at }));
}

export async function createCampaignJournal(
  env: Env,
  access: RoomAccess,
  input: { title: string; content?: string; visibility?: string },
): Promise<CampaignJournalSummary> {
  requireRoomModerator(access);
  const title = nonEmptyText(input.title, '日志标题', 160);
  const content = (input.content ?? '').trim().slice(0, 50_000);
  const visibility = input.visibility === 'players' ? 'players' : 'dm';
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO campaign_journals (id, campaign_id, created_by_user_id, title, content, visibility, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
  ).bind(id, access.campaignId, access.userId, title, content, visibility, now).run();
  return { id, title, content, visibility, updatedAt: now };
}

export async function updateCampaignJournal(
  env: Env,
  access: RoomAccess,
  journalId: string,
  input: { title: string; content?: string; visibility?: string },
): Promise<CampaignJournalSummary> {
  requireRoomModerator(access);
  const title = nonEmptyText(input.title, '日志标题', 160);
  const content = (input.content ?? '').trim().slice(0, 50_000);
  const visibility = input.visibility === 'players' ? 'players' : 'dm';
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE campaign_journals SET title = ?3, content = ?4, visibility = ?5, updated_at = ?6
      WHERE id = ?1 AND campaign_id = ?2 AND deleted_at IS NULL`,
  ).bind(journalId, access.campaignId, title, content, visibility, now).run();
  if (result.meta.changes !== 1) throw new HttpError(404, 'JOURNAL_NOT_FOUND', '找不到战役日志');
  return { id: journalId, title, content, visibility, updatedAt: now };
}

export async function createRoomInvite(env: Env, access: RoomAccess, input: { role: unknown; maxUses?: unknown }): Promise<{ inviteUrl: string; expiresAt: number }> {
  requireRoomModerator(access);
  const role = input.role === 'spectator' ? 'spectator' : input.role === 'player' || input.role === undefined ? 'player' : null;
  if (!role) throw new HttpError(400, 'INVALID_INPUT', '邀请角色只能是玩家或旁观者');
  const maxUses = input.maxUses === undefined ? 1 : boundedInteger(input.maxUses, 1, 50, '邀请次数');
  const rawToken = randomToken(32);
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1_000;
  await env.DB.prepare(
    `INSERT INTO invites
      (id, scope_type, scope_id, room_id, created_by_user_id, grant_role, token_hash, max_uses, created_at, expires_at)
     VALUES (?1, 'room', ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(crypto.randomUUID(), access.roomId, access.userId, role, await sha256Hex(rawToken), maxUses, now, expiresAt).run();

  return { inviteUrl: `/r/${encodeURIComponent(access.roomSlug)}#invite=${rawToken}`, expiresAt };
}

export async function redeemRoomInvite(env: Env, session: Session, token: string): Promise<{ roomSlug: string }> {
  const now = Date.now();
  const invite = await env.DB.prepare(
    `SELECT i.id, i.room_id, i.grant_role, r.slug AS room_slug
       FROM invites i JOIN rooms r ON r.id = i.room_id AND r.deleted_at IS NULL
      WHERE i.token_hash = ?1
        AND i.scope_type = 'room'
        AND i.revoked_at IS NULL
        AND (i.expires_at IS NULL OR i.expires_at > ?2)
        AND (i.max_uses IS NULL OR i.used_count < i.max_uses)`,
  ).bind(await sha256Hex(token), now).first<InviteRow>();
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
  const objectKey = `v1/workspaces/${access.workspaceId}/rooms/${access.roomId}/assets/${id}/source`;
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
  if (access.displayName) headers.set('x-dnd-display-name', encodeURIComponent(access.displayName));
  if (access.characterId) headers.set('x-dnd-character-id', access.characterId);
  if (access.characterName) headers.set('x-dnd-character-name', encodeURIComponent(access.characterName));
  if (access.characterColor) headers.set('x-dnd-character-color', access.characterColor);
  if (access.characterAvatar) headers.set('x-dnd-character-avatar', encodeURIComponent(access.characterAvatar));
  if (access.characterMaxHp) headers.set('x-dnd-character-max-hp', String(access.characterMaxHp));
  return headers;
}

export async function initializeRoom(env: Env, access: RoomAccess): Promise<void> {
  const headers = internalRoomHeaders(access);
  headers.set('content-type', 'application/json');
  const response = await env.ROOMS.getByName(`room:${access.roomId}`).fetch(
    new Request('https://room.internal/initialize', {
      method: 'POST',
      headers,
      body: JSON.stringify({ roomName: access.roomName, campaignId: access.campaignId, campaignName: access.campaignName }),
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

async function requireRoomCampaign(env: Env, access: RoomAccess, campaignId: string): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT 1 AS present FROM room_campaigns WHERE room_id = ?1 AND campaign_id = ?2',
  ).bind(access.roomId, campaignId).first<{ present: number }>();
  if (!row) throw new HttpError(404, 'CAMPAIGN_NOT_FOUND', '找不到该战役存档');
}

function campaignIsConfigured(settingsJson: string): boolean {
  try {
    const value = JSON.parse(settingsJson) as { configured?: unknown };
    return value.configured !== false;
  } catch {
    return true;
  }
}

function characterMaxHp(sheetJson: string | null): number {
  try {
    const value = JSON.parse(sheetJson ?? '{}') as { maxHp?: unknown };
    return typeof value.maxHp === 'number' && Number.isFinite(value.maxHp) ? Math.max(1, Math.round(value.maxHp)) : 10;
  } catch {
    return 10;
  }
}

function characterSummary(row: { id: string; campaign_id: string; name: string; color: string; avatar_url: string; sheet_json: string; updated_at: number }): CampaignCharacterSummary {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    color: row.color,
    avatarUrl: row.avatar_url,
    maxHp: characterMaxHp(row.sheet_json),
    updatedAt: row.updated_at,
  };
}

function moduleFirstScene(templateJson: string | null): string {
  try {
    const value = JSON.parse(templateJson ?? '{}') as { firstSceneName?: unknown };
    return typeof value.firstSceneName === 'string' && value.firstSceneName.trim() ? value.firstSceneName.trim().slice(0, 120) : '起始场景';
  } catch {
    return '起始场景';
  }
}

function compendiumEntryType(value: string): string {
  const allowed = new Set([
    'monster', 'spell', 'item', 'feat', 'condition', 'race', 'subrace', 'background', 'class', 'subclass',
    'classFeature', 'subclassFeature', 'optionalFeature', 'language', 'vehicle', 'action', 'reward',
  ]);
  if (!allowed.has(value)) throw new HttpError(400, 'INVALID_INPUT', '资料类型无效');
  return value;
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
