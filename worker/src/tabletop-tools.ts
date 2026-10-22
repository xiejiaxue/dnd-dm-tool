import {
  canReadDocument,
  canSeeDocument,
  canUpdateDocument,
  DEFAULT_TABLETOP_SETTINGS,
  normalizeDocumentOwnership,
  type ActionLogEntry,
  type ActionLogType,
  type AssetSummary,
  type DocumentOwnership,
  type DocumentViewer,
  type JsonValue,
  type TabletopSettings,
  type ToolDocument,
  type ToolDocumentType,
} from '../../shared/types';
import { isRoomModerator } from './domain';
import { HttpError, isRecord, nonEmptyText } from './http';
import type { RoomAccess } from './repository';

interface ToolRow {
  id: string;
  campaign_id: string;
  document_type: ToolDocumentType;
  name: string;
  folder_path: string;
  sort_order: number;
  data_json: string;
  ownership_json: string;
  locked: number;
  created_by_user_id: string;
  created_at: number;
  updated_at: number;
}

interface ActionRow {
  id: string;
  room_id: string;
  campaign_id: string;
  scene_id: string | null;
  actor_id: string | null;
  target_token_ids_json: string;
  action_type: ActionLogType;
  label: string;
  formula: string | null;
  total: number | null;
  details_json: string;
  visibility: 'all' | 'gm';
  created_by_user_id: string;
  display_name: string;
  created_at: number;
}

interface AssetLibraryRow {
  id: string;
  kind: AssetSummary['kind'];
  content_type: string;
  byte_size: number;
  metadata_json: string;
  created_at: number;
}

export async function listToolDocuments(env: Env, access: RoomAccess, type: ToolDocumentType): Promise<ToolDocument[]> {
  const rows = await env.DB.prepare(
    `SELECT id, campaign_id, document_type, name, folder_path, sort_order,
            data_json, ownership_json, locked, created_by_user_id, created_at, updated_at
       FROM tabletop_documents
      WHERE campaign_id = ?1 AND document_type = ?2 AND deleted_at IS NULL
      ORDER BY folder_path, sort_order, name`,
  ).bind(access.campaignId, type).all<ToolRow>();
  const viewer = documentViewer(access);
  return rows.results.flatMap(row => {
    const ownership = parseOwnership(row.ownership_json);
    if (!canSeeDocument(ownership, viewer)) return [];
    const document = toolFromRow(row, ownership);
    return [canReadDocument(ownership, viewer) ? document : limitedTool(document)];
  });
}

export async function createToolDocument(
  env: Env,
  access: RoomAccess,
  type: ToolDocumentType,
  input: Record<string, unknown>,
): Promise<ToolDocument> {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以创建战役资料');
  const id = crypto.randomUUID();
  const name = nonEmptyText(input.name, '资料名称', 160);
  const folder = optionalText(input.folder, 160);
  const data = normalizeToolData(type, input.data);
  const ownership = ownershipInput(input.ownership);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO tabletop_documents
      (id, campaign_id, document_type, name, folder_path, sort_order, data_json,
       ownership_json, locked, created_by_user_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, 0, ?8, ?9, ?9)`,
  ).bind(id, access.campaignId, type, name, folder, JSON.stringify(data), JSON.stringify(ownership), access.userId, now).run();
  return toolFromRow({
    id, campaign_id: access.campaignId, document_type: type, name, folder_path: folder,
    sort_order: 0, data_json: JSON.stringify(data), ownership_json: JSON.stringify(ownership),
    locked: 0, created_by_user_id: access.userId, created_at: now, updated_at: now,
  }, ownership);
}

export async function updateToolDocument(
  env: Env,
  access: RoomAccess,
  type: ToolDocumentType,
  id: string,
  input: Record<string, unknown>,
): Promise<ToolDocument> {
  const current = await requireTool(env, access, type, id);
  const viewer = documentViewer(access);
  if (!canUpdateDocument(current.ownership, viewer)) throw new HttpError(403, 'FORBIDDEN', '没有资料编辑权限');
  if (current.locked && !isRoomModerator(access.role)) throw new HttpError(403, 'DOCUMENT_LOCKED', '资料已锁定');
  const name = input.name === undefined ? current.name : nonEmptyText(input.name, '资料名称', 160);
  const folder = input.folder === undefined ? current.folder : optionalText(input.folder, 160);
  const ownership = input.ownership === undefined ? current.ownership : moderatorOwnership(access, input.ownership);
  const locked = input.locked === undefined ? current.locked : boolean(input.locked, '锁定状态');
  const data = input.data === undefined ? toolData(current) : normalizeToolData(type, input.data);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE tabletop_documents
        SET name = ?1, folder_path = ?2, data_json = ?3, ownership_json = ?4,
            locked = ?5, updated_at = ?6
      WHERE id = ?7 AND campaign_id = ?8 AND document_type = ?9 AND deleted_at IS NULL`,
  ).bind(name, folder, JSON.stringify(data), JSON.stringify(ownership), locked ? 1 : 0, now, id, access.campaignId, type).run();
  return toolFromRow({
    id, campaign_id: access.campaignId, document_type: type, name, folder_path: folder,
    sort_order: current.sort, data_json: JSON.stringify(data), ownership_json: JSON.stringify(ownership),
    locked: locked ? 1 : 0, created_by_user_id: current.createdByUserId,
    created_at: current.createdAt, updated_at: now,
  }, ownership);
}

export async function deleteToolDocument(env: Env, access: RoomAccess, type: ToolDocumentType, id: string): Promise<void> {
  const current = await requireTool(env, access, type, id);
  if (!canUpdateDocument(current.ownership, documentViewer(access))) throw new HttpError(403, 'FORBIDDEN', '没有资料编辑权限');
  if (current.locked) throw new HttpError(409, 'DOCUMENT_LOCKED', '请先解锁资料再删除');
  await env.DB.prepare(
    `UPDATE tabletop_documents SET deleted_at = ?1, updated_at = ?1
      WHERE id = ?2 AND campaign_id = ?3 AND document_type = ?4 AND deleted_at IS NULL`,
  ).bind(Date.now(), id, access.campaignId, type).run();
}

export async function listActionLog(env: Env, access: RoomAccess, limitValue: unknown): Promise<ActionLogEntry[]> {
  const limit = integer(limitValue, 100, 1, 500);
  const moderator = isRoomModerator(access.role) || access.platformOwner === true;
  const rows = await env.DB.prepare(
    `SELECT l.id, l.room_id, l.campaign_id, l.scene_id, l.actor_id,
            l.target_token_ids_json, l.action_type, l.label, l.formula, l.total,
            l.details_json, l.visibility, l.created_by_user_id, u.display_name, l.created_at
       FROM room_action_log l JOIN users u ON u.id = l.created_by_user_id
      WHERE l.room_id = ?1 ${moderator ? '' : "AND l.visibility = 'all'"}
      ORDER BY l.created_at DESC LIMIT ?2`,
  ).bind(access.roomId, limit).all<ActionRow>();
  return rows.results.map(actionFromRow);
}

export async function createActionLog(env: Env, access: RoomAccess, input: Record<string, unknown>): Promise<ActionLogEntry> {
  const type = actionType(input.type);
  const visibility = input.visibility === 'gm' ? 'gm' : 'all';
  if (visibility === 'gm' && !isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '玩家不能创建主持人私有记录');
  const id = crypto.randomUUID();
  const sceneId = nullableText(input.sceneId, 180);
  const actorId = nullableText(input.actorId, 180);
  const targetTokenIds = stringArray(input.targetTokenIds, 50, 180);
  const label = nonEmptyText(input.label, '记录名称', 240);
  const formula = nullableText(input.formula, 240);
  const total = input.total === null || input.total === undefined ? null : finiteNumber(input.total, '记录总值');
  const details = jsonObject(input.details, 64 * 1024);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO room_action_log
      (id, room_id, campaign_id, scene_id, actor_id, target_token_ids_json,
       action_type, label, formula, total, details_json, visibility,
       created_by_user_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  ).bind(
    id, access.roomId, access.campaignId, sceneId, actorId, JSON.stringify(targetTokenIds),
    type, label, formula, total, JSON.stringify(details), visibility, access.userId, now,
  ).run();
  const user = await env.DB.prepare('SELECT display_name FROM users WHERE id = ?1').bind(access.userId).first<{ display_name: string }>();
  return {
    id, roomId: access.roomId, campaignId: access.campaignId, sceneId, actorId, targetTokenIds,
    type, label, formula, total, details, visibility, createdByUserId: access.userId,
    createdByName: user?.display_name ?? '访客', createdAt: now,
  };
}

export async function clearActionLog(env: Env, access: RoomAccess): Promise<void> {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以清空行动记录');
  await env.DB.prepare('DELETE FROM room_action_log WHERE room_id = ?1').bind(access.roomId).run();
}

export async function getTabletopSettings(env: Env, access: RoomAccess): Promise<TabletopSettings> {
  const row = await env.DB.prepare(
    'SELECT settings_json FROM tabletop_user_settings WHERE room_id = ?1 AND user_id = ?2',
  ).bind(access.roomId, access.userId).first<{ settings_json: string }>();
  return normalizeSettings(parseObject(row?.settings_json));
}

export async function updateTabletopSettings(env: Env, access: RoomAccess, input: Record<string, unknown>): Promise<TabletopSettings> {
  const current = await getTabletopSettings(env, access);
  const settings = normalizeSettings({ ...current, ...input });
  await env.DB.prepare(
    `INSERT INTO tabletop_user_settings (room_id, user_id, settings_json, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(room_id, user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
  ).bind(access.roomId, access.userId, JSON.stringify(settings), Date.now()).run();
  return settings;
}

export async function listAssetLibrary(env: Env, access: RoomAccess, includeArchived: boolean): Promise<AssetSummary[]> {
  const rows = await env.DB.prepare(
    `SELECT id, kind, content_type, byte_size, metadata_json, created_at
       FROM assets
      WHERE workspace_id = ?1 AND campaign_id = ?2 AND deleted_at IS NULL
      ORDER BY created_at DESC`,
  ).bind(access.workspaceId, access.campaignId).all<AssetLibraryRow>();
  return rows.results.flatMap(row => {
    const metadata = parseObject(row.metadata_json);
    if (metadata.archived === true && !includeArchived) return [];
    return [{
      id: row.id,
      name: typeof metadata.displayName === 'string' ? metadata.displayName : typeof metadata.filename === 'string' ? metadata.filename : row.id,
      kind: row.kind,
      url: `/api/rooms/${encodeURIComponent(access.roomSlug)}/assets/${row.id}`,
      contentType: row.content_type,
      byteSize: row.byte_size,
      createdAt: row.created_at,
      archived: metadata.archived === true,
    }];
  });
}

export async function updateAssetLibraryEntry(env: Env, access: RoomAccess, id: string, input: Record<string, unknown>): Promise<void> {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以管理素材');
  const row = await env.DB.prepare(
    `SELECT metadata_json FROM assets
      WHERE id = ?1 AND workspace_id = ?2 AND campaign_id = ?3 AND deleted_at IS NULL`,
  ).bind(id, access.workspaceId, access.campaignId).first<{ metadata_json: string }>();
  if (!row) throw new HttpError(404, 'ASSET_NOT_FOUND', '找不到素材');
  const metadata = parseObject(row.metadata_json);
  if (input.name !== undefined) metadata.displayName = nonEmptyText(input.name, '素材名称', 200);
  if (input.archived !== undefined) metadata.archived = boolean(input.archived, '归档状态');
  await env.DB.prepare('UPDATE assets SET metadata_json = ?1 WHERE id = ?2').bind(JSON.stringify(metadata), id).run();
}

function toolFromRow(row: ToolRow, ownership = parseOwnership(row.ownership_json)): ToolDocument {
  const base = {
    id: row.id,
    campaignId: row.campaign_id,
    documentType: row.document_type,
    name: row.name,
    folder: row.folder_path,
    sort: row.sort_order,
    ownership,
    locked: row.locked === 1,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return { ...base, ...parseObject(row.data_json) } as ToolDocument;
}

function limitedTool(document: ToolDocument): ToolDocument {
  if (document.documentType === 'item') return { ...document, description: '', system: {}, actions: [], effects: [] };
  if (document.documentType === 'roll_table') return { ...document, results: [] };
  if (document.documentType === 'playlist') return { ...document, tracks: [] };
  return { ...document, combatants: [], notes: '' };
}

function toolData(document: ToolDocument): Record<string, JsonValue> {
  const { id: _id, campaignId: _campaignId, documentType: _documentType, name: _name,
    folder: _folder, sort: _sort, ownership: _ownership, locked: _locked,
    createdByUserId: _createdByUserId, createdAt: _createdAt, updatedAt: _updatedAt,
    ...data } = document;
  return data as unknown as Record<string, JsonValue>;
}

function normalizeToolData(type: ToolDocumentType, value: unknown): Record<string, JsonValue> {
  const data = jsonObject(value, 256 * 1024);
  if (type === 'item') {
    const allowed = new Set(['weapon', 'armor', 'consumable', 'spell', 'feat', 'equipment', 'loot']);
    const itemType = typeof data.itemType === 'string' && allowed.has(data.itemType) ? data.itemType : 'equipment';
    return {
      itemType,
      image: typeof data.image === 'string' ? data.image.slice(0, 500) : '',
      description: typeof data.description === 'string' ? data.description.slice(0, 128 * 1024) : '',
      system: isRecord(data.system) ? data.system : {},
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 100) : [],
      effects: Array.isArray(data.effects) ? data.effects.slice(0, 100) : [],
    } as Record<string, JsonValue>;
  }
  if (type === 'roll_table') return {
    replacement: data.replacement !== false,
    results: Array.isArray(data.results) ? data.results.slice(0, 1000) : [],
  };
  if (type === 'playlist') return {
    tracks: Array.isArray(data.tracks) ? data.tracks.slice(0, 200) : [],
  };
  return {
    combatants: Array.isArray(data.combatants) ? data.combatants.slice(0, 200) : [],
    notes: typeof data.notes === 'string' ? data.notes.slice(0, 64 * 1024) : '',
  };
}

async function requireTool(env: Env, access: RoomAccess, type: ToolDocumentType, id: string): Promise<ToolDocument> {
  const row = await env.DB.prepare(
    `SELECT id, campaign_id, document_type, name, folder_path, sort_order,
            data_json, ownership_json, locked, created_by_user_id, created_at, updated_at
       FROM tabletop_documents
      WHERE id = ?1 AND campaign_id = ?2 AND document_type = ?3 AND deleted_at IS NULL`,
  ).bind(id, access.campaignId, type).first<ToolRow>();
  if (!row) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '找不到战役资料');
  return toolFromRow(row);
}

function actionFromRow(row: ActionRow): ActionLogEntry {
  return {
    id: row.id, roomId: row.room_id, campaignId: row.campaign_id,
    sceneId: row.scene_id, actorId: row.actor_id,
    targetTokenIds: parseStringArray(row.target_token_ids_json), type: row.action_type,
    label: row.label, formula: row.formula, total: row.total, details: parseObject(row.details_json),
    visibility: row.visibility, createdByUserId: row.created_by_user_id,
    createdByName: row.display_name, createdAt: row.created_at,
  };
}

function documentViewer(access: RoomAccess): DocumentViewer {
  return { userId: access.userId, roomRole: access.role, platformReadOnly: access.platformOwner === true && !isRoomModerator(access.role) };
}

function ownershipInput(value: unknown): DocumentOwnership {
  return normalizeDocumentOwnership(value);
}

function moderatorOwnership(access: RoomAccess, value: unknown): DocumentOwnership {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以修改权限');
  return ownershipInput(value);
}

function parseOwnership(value: string): DocumentOwnership {
  return normalizeDocumentOwnership(parseObject(value));
}

function normalizeSettings(value: Record<string, unknown>): TabletopSettings {
  const bindings = isRecord(value.keybindings) ? value.keybindings : {};
  return {
    compactMode: typeof value.compactMode === 'boolean' ? value.compactMode : DEFAULT_TABLETOP_SETTINGS.compactMode,
    reduceMotion: typeof value.reduceMotion === 'boolean' ? value.reduceMotion : DEFAULT_TABLETOP_SETTINGS.reduceMotion,
    fontScale: typeof value.fontScale === 'number' && Number.isFinite(value.fontScale) ? Math.max(.8, Math.min(1.4, value.fontScale)) : 1,
    confirmDestructiveActions: typeof value.confirmDestructiveActions === 'boolean' ? value.confirmDestructiveActions : true,
    defaultRollMode: value.defaultRollMode === 'gm' ? 'gm' : 'all',
    showFloatingText: typeof value.showFloatingText === 'boolean' ? value.showFloatingText : true,
    keybindings: {
      ...DEFAULT_TABLETOP_SETTINGS.keybindings,
      ...Object.fromEntries(Object.entries(bindings).flatMap(([key, entry]) => typeof entry === 'string' ? [[key.slice(0, 80), entry.slice(0, 40)]] : [])),
    },
  };
}

function actionType(value: unknown): ActionLogType {
  const types: ActionLogType[] = ['roll', 'damage', 'healing', 'effect', 'encounter', 'handout', 'system'];
  if (typeof value === 'string' && types.includes(value as ActionLogType)) return value as ActionLogType;
  throw new HttpError(400, 'INVALID_INPUT', '行动记录类型无效');
}

function jsonObject(value: unknown, maximumBytes: number): Record<string, JsonValue> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new HttpError(400, 'INVALID_INPUT', '资料内容必须是对象');
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > maximumBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '资料内容过大');
  return JSON.parse(encoded) as Record<string, JsonValue>;
}

function parseObject(value: string | undefined): Record<string, JsonValue> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed as Record<string, JsonValue> : {};
  } catch { return {}; }
}

function stringArray(value: unknown, maximumItems: number, maximumLength: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumItems || value.some(item => typeof item !== 'string' || item.length > maximumLength)) {
    throw new HttpError(400, 'INVALID_INPUT', '目标列表无效');
  }
  return [...new Set(value as string[])];
}

function parseStringArray(value: string): string[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []; }
  catch { return []; }
}

function optionalText(value: unknown, maximumLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

function nullableText(value: unknown, maximumLength: number): string | null {
  const text = optionalText(value, maximumLength);
  return text || null;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, 'INVALID_INPUT', `${label}无效`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, 'INVALID_INPUT', `${label}无效`);
  return value;
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : fallback;
  return Number.isInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}
