import { prepareModuleScenes, modulePrefix, templateAssetPrefix } from "./module-template";
import { LEGACY_TEMPLATE_ID, findModule } from "./modules/registry";
import { sha256Hex } from "./auth";
import {
  requireCampaignAccess,
  createCampaignInvite,
  redeemCampaignInvite,
} from "./campaigns";
import { isRoomModerator, type RoomActor, type RoomRole } from "./domain";
import { HttpError, nonEmptyText } from "./http";

export interface RoomAccess extends RoomActor {
  roomId: string;
  roomSlug: string;
  roomName: string;
  roomStatus: "lobby" | "live" | "ended" | "archived";
  roomAccessEpoch: number;
  campaignId: string;
  campaignName: string;
  workspaceId: string;
  campaignMemberId: string | null;
  campaignConfigured: boolean;
  runtimeInitialized?: boolean;
  firstSceneName?: string;
  templateId?: string;
}

export interface CampaignModuleSummary {
  id: string;
  name: string;
  description: string;
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
  visibility: "dm" | "players";
  updatedAt: number;
}

interface AssetRow {
  id: string;
  object_key: string;
  content_type: string;
  byte_size: number;
}

export const requireRoomAccess = requireCampaignAccess;
export function requireRoomModerator(access: RoomAccess): void {
  if (!isRoomModerator(access.role))
    throw new HttpError(403, "FORBIDDEN", "只有主持人可执行此操作");
}

export async function listCampaignCharacters(
  env: Env,
  access: RoomAccess,
  campaignId: string,
): Promise<CampaignCharacterSummary[]> {
  await requireRoomCampaign(env, access, campaignId);
  const result = await env.DB.prepare(
    `SELECT id, campaign_id, name, color, avatar_url, sheet_json, updated_at
       FROM campaign_characters
      WHERE campaign_id = ?1 AND owner_user_id = ?2 AND status = 'active' AND deleted_at IS NULL
      ORDER BY updated_at DESC`,
  )
    .bind(campaignId, access.userId)
    .all<{
      id: string;
      campaign_id: string;
      name: string;
      color: string;
      avatar_url: string;
      sheet_json: string;
      updated_at: number;
    }>();
  return result.results.map(characterSummary);
}

export async function createCampaignCharacter(
  env: Env,
  access: RoomAccess,
  input: { campaignId: string; name: string; color?: string; maxHp?: number },
): Promise<CampaignCharacterSummary> {
  await requireRoomCampaign(env, access, input.campaignId);
  const name = nonEmptyText(input.name, "角色名称");
  const color = /^#[0-9a-f]{6}$/iu.test(input.color ?? "")
    ? input.color!
    : "#38a169";
  const maxHp = Math.max(
    1,
    Math.min(
      9999,
      Number.isFinite(input.maxHp) ? Math.round(input.maxHp!) : 10,
    ),
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  const sheet = JSON.stringify({ maxHp });
  await env.DB.prepare(
    `INSERT INTO campaign_characters
      (id, campaign_id, owner_user_id, name, color, sheet_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
  )
    .bind(id, input.campaignId, access.userId, name, color, sheet, now)
    .run();
  return {
    id,
    campaignId: input.campaignId,
    name,
    color,
    avatarUrl: "",
    maxHp,
    updatedAt: now,
  };
}

export async function selectCampaignCharacter(
  env: Env,
  access: RoomAccess,
  campaignId: string,
  characterId: string,
): Promise<CampaignCharacterSummary> {
  await requireRoomCampaign(env, access, campaignId);
  const row = await env.DB.prepare(
    `SELECT id, campaign_id, name, color, avatar_url, sheet_json, updated_at
       FROM campaign_characters
      WHERE id = ?1 AND campaign_id = ?2 AND owner_user_id = ?3 AND status = 'active' AND deleted_at IS NULL`,
  )
    .bind(characterId, campaignId, access.userId)
    .first<{
      id: string;
      campaign_id: string;
      name: string;
      color: string;
      avatar_url: string;
      sheet_json: string;
      updated_at: number;
    }>();
  if (!row) throw new HttpError(404, "CHARACTER_NOT_FOUND", "找不到该角色");
  await env.DB.prepare(
    `INSERT INTO campaign_character_selections (campaign_id, user_id, character_id, selected_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(campaign_id, user_id)
     DO UPDATE SET character_id = excluded.character_id, selected_at = excluded.selected_at`,
  )
    .bind(campaignId, access.userId, characterId, Date.now())
    .run();
  return characterSummary(row);
}

export async function getSelectedCharacterSheet(
  env: Env,
  access: RoomAccess,
): Promise<{
  character: CampaignCharacterSummary;
  entries: CharacterCompendiumEntry[];
}> {
  if (!access.characterId)
    throw new HttpError(404, "CHARACTER_NOT_SELECTED", "当前战役尚未选择角色");
  const character = await env.DB.prepare(
    `SELECT id, campaign_id, name, color, avatar_url, sheet_json, updated_at
       FROM campaign_characters
      WHERE id = ?1 AND campaign_id = ?2 AND owner_user_id = ?3 AND deleted_at IS NULL`,
  )
    .bind(access.characterId, access.campaignId, access.userId)
    .first<{
      id: string;
      campaign_id: string;
      name: string;
      color: string;
      avatar_url: string;
      sheet_json: string;
      updated_at: number;
    }>();
  if (!character)
    throw new HttpError(404, "CHARACTER_NOT_FOUND", "找不到当前角色");
  const entries = await env.DB.prepare(
    `SELECT id, entry_type, entry_id, display_name, source, quantity, prepared
       FROM campaign_character_entries WHERE character_id = ?1
      ORDER BY entry_type, display_name COLLATE NOCASE`,
  )
    .bind(access.characterId)
    .all<{
      id: string;
      entry_type: string;
      entry_id: string;
      display_name: string;
      source: string;
      quantity: number;
      prepared: number;
    }>();
  return {
    character: characterSummary(character),
    entries: entries.results.map((entry) => ({
      id: entry.id,
      type: entry.entry_type,
      entryId: entry.entry_id,
      name: entry.display_name,
      source: entry.source,
      quantity: entry.quantity,
      prepared: entry.prepared === 1,
    })),
  };
}

export async function addSelectedCharacterEntry(
  env: Env,
  access: RoomAccess,
  input: { type: string; entryId: string; name: string; source?: string },
): Promise<CharacterCompendiumEntry> {
  if (!access.characterId || access.role !== "player")
    throw new HttpError(403, "FORBIDDEN", "请先选择玩家角色");
  const type = compendiumEntryType(input.type);
  const entryId = nonEmptyText(input.entryId, "资料 ID", 300);
  const name = nonEmptyText(input.name, "资料名称", 160);
  const source = (input.source ?? "").trim().slice(0, 64);
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO campaign_character_entries
      (id, character_id, entry_type, entry_id, display_name, source, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT(character_id, entry_type, entry_id)
     DO UPDATE SET display_name = excluded.display_name, source = excluded.source, updated_at = excluded.updated_at`,
  )
    .bind(id, access.characterId, type, entryId, name, source, now)
    .run();
  const row = await env.DB.prepare(
    `SELECT id, entry_type, entry_id, display_name, source, quantity, prepared
       FROM campaign_character_entries WHERE character_id = ?1 AND entry_type = ?2 AND entry_id = ?3`,
  )
    .bind(access.characterId, type, entryId)
    .first<{
      id: string;
      entry_type: string;
      entry_id: string;
      display_name: string;
      source: string;
      quantity: number;
      prepared: number;
    }>();
  if (!row) throw new HttpError(500, "INTERNAL", "无法保存角色资料");
  return {
    id: row.id,
    type: row.entry_type,
    entryId: row.entry_id,
    name: row.display_name,
    source: row.source,
    quantity: row.quantity,
    prepared: row.prepared === 1,
  };
}

export async function removeSelectedCharacterEntry(
  env: Env,
  access: RoomAccess,
  entryId: string,
): Promise<void> {
  if (!access.characterId || access.role !== "player")
    throw new HttpError(403, "FORBIDDEN", "请先选择玩家角色");
  const result = await env.DB.prepare(
    "DELETE FROM campaign_character_entries WHERE id = ?1 AND character_id = ?2",
  )
    .bind(entryId, access.characterId)
    .run();
  if (result.meta.changes !== 1)
    throw new HttpError(404, "ENTRY_NOT_FOUND", "找不到角色资料");
}

export async function listCampaignJournals(
  env: Env,
  access: RoomAccess,
): Promise<CampaignJournalSummary[]> {
  const moderator = isRoomModerator(access.role);
  const result = await env.DB.prepare(
    `SELECT id, title, content, visibility, updated_at FROM campaign_journals
      WHERE campaign_id = ?1 AND deleted_at IS NULL
        AND (?2 = 1 OR visibility = 'players')
      ORDER BY updated_at DESC`,
  )
    .bind(access.campaignId, moderator ? 1 : 0)
    .all<{
      id: string;
      title: string;
      content: string;
      visibility: "dm" | "players";
      updated_at: number;
    }>();
  return result.results.map((entry) => ({
    id: entry.id,
    title: entry.title,
    content: entry.content,
    visibility: entry.visibility,
    updatedAt: entry.updated_at,
  }));
}

export async function createCampaignJournal(
  env: Env,
  access: RoomAccess,
  input: { title: string; content?: string; visibility?: string },
): Promise<CampaignJournalSummary> {
  requireRoomModerator(access);
  const title = nonEmptyText(input.title, "日志标题", 160);
  const content = journalContent(input.content);
  const visibility = input.visibility === "players" ? "players" : "dm";
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO campaign_journals (id, campaign_id, created_by_user_id, title, content, visibility, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
  )
    .bind(id, access.campaignId, access.userId, title, content, visibility, now)
    .run();
  return { id, title, content, visibility, updatedAt: now };
}

export async function updateCampaignJournal(
  env: Env,
  access: RoomAccess,
  journalId: string,
  input: { title: string; content?: string; visibility?: string },
): Promise<CampaignJournalSummary> {
  requireRoomModerator(access);
  const title = nonEmptyText(input.title, "日志标题", 160);
  const content = journalContent(input.content);
  const visibility = input.visibility === "players" ? "players" : "dm";
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE campaign_journals SET title = ?3, content = ?4, visibility = ?5, updated_at = ?6
      WHERE id = ?1 AND campaign_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(journalId, access.campaignId, title, content, visibility, now)
    .run();
  if (result.meta.changes !== 1)
    throw new HttpError(404, "JOURNAL_NOT_FOUND", "找不到战役日志");
  return { id: journalId, title, content, visibility, updatedAt: now };
}

export const JOURNAL_CONTENT_LIMIT = 50_000;

// Reject rather than silently cut a long journal; the editor shows the limit.
function journalContent(value: string | undefined): string {
  const content = (value ?? "").trim();
  if (content.length > JOURNAL_CONTENT_LIMIT)
    throw new HttpError(400, "JOURNAL_TOO_LONG", `日志内容不能超过 ${JOURNAL_CONTENT_LIMIT} 字`);
  return content;
}

export async function deleteCampaignJournal(
  env: Env,
  access: RoomAccess,
  journalId: string,
): Promise<void> {
  requireRoomModerator(access);
  const result = await env.DB.prepare(
    `UPDATE campaign_journals SET deleted_at = ?3
      WHERE id = ?1 AND campaign_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(journalId, access.campaignId, Date.now())
    .run();
  if (result.meta.changes !== 1)
    throw new HttpError(404, "JOURNAL_NOT_FOUND", "找不到战役日志");
}

export const createRoomInvite = createCampaignInvite;
export const redeemRoomInvite = redeemCampaignInvite;

export async function createAsset(
  env: Env,
  access: RoomAccess,
  file: File,
  kindValue: FormDataEntryValue | null,
): Promise<{ id: string; url: string }> {
  const kind =
    typeof kindValue === "string" &&
    ["map", "token", "avatar", "attachment"].includes(kindValue)
      ? kindValue
      : "map";
  const playerAvatarUpload =
    access.role === "player" && (kind === "token" || kind === "avatar");
  if (!isRoomModerator(access.role) && !playerAvatarUpload) {
    throw new HttpError(403, "FORBIDDEN", "只有主持人可上传此类素材");
  }
  const allowedTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif",
  ]);
  if (!allowedTypes.has(file.type))
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA",
      "仅支持 JPEG、PNG、WebP 或 AVIF 图片",
    );
  if (file.size <= 0 || file.size > 10 * 1024 * 1024)
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "图片必须小于 10 MiB");
  const bytes = await file.arrayBuffer();
  if (!looksLikeImage(bytes, file.type))
    throw new HttpError(415, "UNSUPPORTED_MEDIA", "文件内容不是声明的图片格式");

  const id = crypto.randomUUID();
  const objectKey = `v2/campaigns/${access.campaignId}/assets/${id}/source`;
  const now = Date.now();
  await env.ROOM_ASSETS.put(objectKey, bytes, {
    httpMetadata: { contentType: file.type },
  });
  try {
    await env.DB.prepare(
      `INSERT INTO assets
        (id, workspace_id, campaign_id, created_by_user_id, kind, visibility, object_key, content_type, byte_size, sha256, metadata_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'campaign', ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
      .bind(
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
      )
      .run();
  } catch (error) {
    await env.ROOM_ASSETS.delete(objectKey);
    throw error;
  }
  return {
    id,
    url: `/api/campaigns/${encodeURIComponent(access.roomSlug)}/assets/${id}`,
  };
}

export async function getAsset(
  env: Env,
  access: RoomAccess,
  assetId: string,
): Promise<{ metadata: AssetRow; object: R2ObjectBody }> {
  const metadata = await env.DB.prepare(
    `SELECT id, object_key, content_type, byte_size
       FROM assets
      WHERE id = ?1 AND workspace_id = ?2 AND campaign_id = ?3 AND deleted_at IS NULL`,
  )
    .bind(assetId, access.workspaceId, access.campaignId)
    .first<AssetRow>();
  if (!metadata) throw new HttpError(404, "ASSET_NOT_FOUND", "找不到素材");
  const templateId = access.templateId ?? LEGACY_TEMPLATE_ID;
  const prefix = templateAssetPrefix(access.campaignId, templateId);
  const templateAsset = metadata.object_key.startsWith(prefix)
    ? metadata.object_key.slice(prefix.length) : null;
  const object = findModule(templateId) && templateAsset && /^map-[a-z0-9-]+$/.test(templateAsset)
    ? await env.REFERENCE_DATA.get(`${modulePrefix(templateId)}assets/${templateAsset}`)
    : await env.ROOM_ASSETS.get(metadata.object_key);
  if (!object) throw new HttpError(404, "ASSET_NOT_FOUND", "找不到素材");
  return { metadata, object };
}

export function internalRoomHeaders(access: RoomAccess): Headers {
  const headers = new Headers();
  headers.set("x-dnd-internal-request", "1");
  headers.set("x-dnd-room-id", access.roomId);
  headers.set("x-dnd-campaign-id", access.campaignId);
  headers.set("x-dnd-user-id", access.userId);
  headers.set("x-dnd-member-id", access.memberId);
  headers.set("x-dnd-room-role", access.role);
  headers.set("x-dnd-access-epoch", String(access.accessEpoch));
  if (access.displayName)
    headers.set("x-dnd-display-name", encodeURIComponent(access.displayName));
  if (access.characterId) headers.set("x-dnd-character-id", access.characterId);
  if (access.characterName)
    headers.set(
      "x-dnd-character-name",
      encodeURIComponent(access.characterName),
    );
  if (access.characterColor)
    headers.set("x-dnd-character-color", access.characterColor);
  if (access.characterAvatar)
    headers.set(
      "x-dnd-character-avatar",
      encodeURIComponent(access.characterAvatar),
    );
  if (access.characterMaxHp)
    headers.set("x-dnd-character-max-hp", String(access.characterMaxHp));
  return headers;
}

export async function initializeRoom(
  env: Env,
  access: RoomAccess,
): Promise<void> {
  if (access.runtimeInitialized) return;
  const scenes = await prepareModuleScenes(env, access);
  const headers = internalRoomHeaders(access);
  headers.set("content-type", "application/json");
  const response = await env.ROOMS.getByName(
    `campaign:${access.campaignId}`,
  ).fetch(
    new Request("https://room.internal/initialize", {
      method: "POST",
      headers,
      body: JSON.stringify({
        roomName: access.campaignName,
        campaignName: access.campaignName,
        campaignId: access.campaignId,
        firstSceneName: access.firstSceneName,
        singleCampaign: true,
        scenes,
      }),
    }),
  );
  if (!response.ok)
    throw new HttpError(
      503,
      "CAMPAIGN_UNAVAILABLE",
      "战役初始化未完成，请重试",
    );
  await env.DB.prepare(
    "UPDATE campaigns SET runtime_initialized_at=?2 WHERE id=?1 AND runtime_initialized_at IS NULL",
  )
    .bind(access.campaignId, Date.now())
    .run();
  access.runtimeInitialized = true;
}

export async function callRoom(
  env: Env,
  access: RoomAccess,
  method: string,
  path: string,
  payload?: unknown,
): Promise<Response> {
  await initializeRoom(env, access);
  const headers = internalRoomHeaders(access);
  let body: string | undefined;
  if (payload !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(payload);
  }
  return env.ROOMS.getByName(`campaign:${access.campaignId}`).fetch(
    new Request(`https://room.internal${path}`, { method, headers, body }),
  );
}

export async function forwardRoomWebSocket(
  env: Env,
  access: RoomAccess,
  request: Request,
): Promise<Response> {
  await initializeRoom(env, access);
  const headers = new Headers(request.headers);
  internalRoomHeaders(access).forEach((value, key) => headers.set(key, value));
  return env.ROOMS.getByName(`campaign:${access.campaignId}`).fetch(
    new Request("https://room.internal/connect", { method: "GET", headers }),
  );
}

async function requireRoomCampaign(
  _env: Env,
  access: RoomAccess,
  campaignId: string,
): Promise<void> {
  if (campaignId !== access.campaignId)
    throw new HttpError(404, "CAMPAIGN_NOT_FOUND", "找不到该战役");
}

function characterMaxHp(sheetJson: string | null): number {
  try {
    const value = JSON.parse(sheetJson ?? "{}") as { maxHp?: unknown };
    return typeof value.maxHp === "number" && Number.isFinite(value.maxHp)
      ? Math.max(1, Math.round(value.maxHp))
      : 10;
  } catch {
    return 10;
  }
}

function characterSummary(row: {
  id: string;
  campaign_id: string;
  name: string;
  color: string;
  avatar_url: string;
  sheet_json: string;
  updated_at: number;
}): CampaignCharacterSummary {
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

function compendiumEntryType(value: string): string {
  const allowed = new Set([
    "monster",
    "spell",
    "item",
    "feat",
    "condition",
    "race",
    "subrace",
    "background",
    "class",
    "subclass",
    "classFeature",
    "subclassFeature",
    "optionalFeature",
    "language",
    "vehicle",
    "action",
    "reward",
  ]);
  if (!allowed.has(value))
    throw new HttpError(400, "INVALID_INPUT", "资料类型无效");
  return value;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      `${label}必须是 ${minimum} 到 ${maximum} 的整数`,
    );
  }
  return value;
}

function looksLikeImage(buffer: ArrayBuffer, type: string): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 16));
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (type === "image/jpeg") return startsWith(0xff, 0xd8, 0xff);
  if (type === "image/png")
    return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (type === "image/webp")
    return (
      startsWith(0x52, 0x49, 0x46, 0x46) &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  if (type === "image/avif")
    return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  return false;
}
