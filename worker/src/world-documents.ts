import {
  canReadDocument,
  canSeeDocument,
  canUpdateDocument,
  DEFAULT_TOKEN_SIZE,
  normalizeDocumentOwnership,
  type ActorClaim,
  type ActorDocument,
  type ActorDocumentType,
  type ActorPrototypeToken,
  type DocumentFlags,
  type DocumentFolder,
  type DocumentOwnership,
  type FolderDocumentType,
  type DocumentViewer,
  type JournalEntryDocument,
  type JournalPage,
  type JournalPageType,
  type JsonValue,
  type MacroCommand,
  type MacroDocument,
  type MacroHotbarBinding,
  type MapNote,
} from '../../shared/types';
import { HttpError, isRecord, nonEmptyText } from './http';
import { isRoomModerator } from './domain';
import type { RoomAccess } from './repository';

interface ActorRow {
  id: string;
  campaign_id: string;
  name: string;
  actor_type: ActorDocumentType;
  folder_id: string | null;
  sort_order: number;
  avatar_url: string;
  system_json: string;
  prototype_token_json: string;
  ownership_json: string;
  flags_json: string;
  created_by_user_id: string;
  created_at: number;
  updated_at: number;
}

interface ClaimRow {
  room_id: string;
  actor_id: string;
  user_id: string;
  claimed_at: number;
}

interface JournalRow {
  id: string;
  campaign_id: string;
  name: string;
  folder_id: string | null;
  sort_order: number;
  ownership_json: string;
  flags_json: string;
  created_by_user_id: string;
  created_at: number;
  updated_at: number;
}

interface PageRow {
  id: string;
  journal_id: string;
  name: string;
  page_type: JournalPageType;
  sort_order: number;
  text_content: string;
  asset_url: string | null;
  flags_json: string;
  created_at: number;
  updated_at: number;
}

interface NoteRow {
  id: string;
  scene_id: string;
  journal_id: string;
  page_id: string | null;
  x: number;
  y: number;
  label: string;
  icon: string;
  visibility: MapNote['visibility'];
  flags_json: string;
  ownership_json: string;
}

interface MacroRow {
  id: string;
  campaign_id: string;
  name: string;
  folder_id: string | null;
  sort_order: number;
  command_json: string;
  icon: string;
  ownership_json: string;
  flags_json: string;
  created_by_user_id: string;
  created_at: number;
  updated_at: number;
}

interface FolderRow {
  id: string;
  campaign_id: string;
  document_type: FolderDocumentType;
  parent_id: string | null;
  name: string;
  sort_order: number;
  flags_json: string;
}

export interface ActorDirectory {
  actors: ActorDocument[];
  claim: ActorClaim | null;
}

export async function listDocumentFolders(env: Env, access: RoomAccess, documentType: string): Promise<DocumentFolder[]> {
  const type = folderDocumentType(documentType);
  const result = await env.DB.prepare(
    `SELECT id, campaign_id, document_type, parent_id, name, sort_order, flags_json
       FROM document_folders
      WHERE campaign_id = ?1 AND document_type = ?2 AND deleted_at IS NULL
      ORDER BY parent_id, sort_order, name`,
  ).bind(access.campaignId, type).all<FolderRow>();
  return result.results.map(folderFromRow);
}

export async function createDocumentFolder(
  env: Env,
  access: RoomAccess,
  documentType: string,
  input: Record<string, unknown>,
): Promise<DocumentFolder> {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以创建目录');
  const type = folderDocumentType(documentType);
  const name = nonEmptyText(input.name, '目录名称', 120);
  const parentId = input.parentId === null || input.parentId === undefined ? null : nonEmptyText(input.parentId, '上级目录', 180);
  if (parentId) await requireFolder(env, access, type, parentId);
  const sort = optionalSort(input.sort, 0);
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO document_folders
        (id, campaign_id, document_type, parent_id, name, sort_order, flags_json, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', ?7, ?7)`,
    ).bind(id, access.campaignId, type, parentId, name, sort, now).run();
  } catch {
    throw new HttpError(409, 'FOLDER_EXISTS', '同级目录中已存在同名目录');
  }
  return { id, campaignId: access.campaignId, documentType: type, parentId, name, sort, flags: {} };
}

export async function updateDocumentFolder(
  env: Env,
  access: RoomAccess,
  documentType: string,
  folderId: string,
  input: Record<string, unknown>,
): Promise<DocumentFolder> {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以编辑目录');
  const type = folderDocumentType(documentType);
  const folder = await requireFolder(env, access, type, folderId);
  const name = input.name === undefined ? folder.name : nonEmptyText(input.name, '目录名称', 120);
  const parentId = input.parentId === undefined
    ? folder.parentId
    : input.parentId === null ? null : nonEmptyText(input.parentId, '上级目录', 180);
  if (parentId === folderId) throw new HttpError(400, 'INVALID_INPUT', '目录不能成为自己的上级');
  if (parentId) {
    let ancestorId: string | null = parentId;
    const visited = new Set<string>();
    while (ancestorId) {
      if (ancestorId === folderId || visited.has(ancestorId)) {
        throw new HttpError(400, 'INVALID_INPUT', '不能建立循环目录');
      }
      visited.add(ancestorId);
      ancestorId = (await requireFolder(env, access, type, ancestorId)).parentId;
    }
  }
  const sort = optionalSort(input.sort, folder.sort);
  const now = Date.now();
  try {
    await env.DB.prepare(
      `UPDATE document_folders SET name = ?1, parent_id = ?2, sort_order = ?3, updated_at = ?4
        WHERE id = ?5 AND campaign_id = ?6 AND document_type = ?7 AND deleted_at IS NULL`,
    ).bind(name, parentId, sort, now, folderId, access.campaignId, type).run();
  } catch {
    throw new HttpError(409, 'FOLDER_EXISTS', '同级目录中已存在同名目录');
  }
  return { ...folder, name, parentId, sort };
}

export async function deleteDocumentFolder(env: Env, access: RoomAccess, documentType: string, folderId: string): Promise<void> {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以删除目录');
  const type = folderDocumentType(documentType);
  await requireFolder(env, access, type, folderId);
  const table = type === 'actor' ? 'actors' : type === 'journal' ? 'journal_entries' : 'macros';
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE ${table} SET folder_id = NULL, updated_at = ?1 WHERE campaign_id = ?2 AND folder_id = ?3 AND deleted_at IS NULL`).bind(now, access.campaignId, folderId),
    env.DB.prepare('UPDATE document_folders SET parent_id = NULL, updated_at = ?1 WHERE campaign_id = ?2 AND parent_id = ?3 AND deleted_at IS NULL').bind(now, access.campaignId, folderId),
    env.DB.prepare('UPDATE document_folders SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND campaign_id = ?3 AND document_type = ?4 AND deleted_at IS NULL').bind(now, folderId, access.campaignId, type),
  ]);
}

export async function listActors(env: Env, access: RoomAccess): Promise<ActorDirectory> {
  const result = await env.DB.prepare(
    `SELECT id, campaign_id, name, actor_type, folder_id, sort_order, avatar_url,
            system_json, prototype_token_json, ownership_json, flags_json,
            created_by_user_id, created_at, updated_at
       FROM actors
      WHERE campaign_id = ?1 AND deleted_at IS NULL
      ORDER BY folder_id, sort_order, name`,
  ).bind(access.campaignId).all<ActorRow>();
  const viewer = documentViewer(access);
  const actors = result.results.flatMap(row => {
    const actor = actorFromRow(row);
    if (!canSeeDocument(actor.ownership, viewer)) return [];
    return [projectActor(actor, viewer)];
  });
  return { actors, claim: await currentActorClaim(env, access) };
}

export async function createActor(env: Env, access: RoomAccess, input: Record<string, unknown>): Promise<ActorDocument> {
  const name = nonEmptyText(input.name, '角色名称', 120);
  const actorType = actorDocumentType(input.actorType ?? 'character');
  if (!isRoomModerator(access.role) && actorType !== 'character') {
    throw new HttpError(403, 'FORBIDDEN', '玩家只能创建自己的角色');
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  const ownership = isRoomModerator(access.role)
    ? ownershipInput(input.ownership)
    : { default: 'none' as const, users: { [access.userId]: 'owner' as const } };
  const avatar = optionalText(input.avatar, '角色头像', 500) ?? '';
  const system = jsonObject(input.system, '角色数据', 64 * 1024);
  const prototypeToken = prototypeTokenInput(input.prototypeToken, name, avatar);
  await env.DB.prepare(
    `INSERT INTO actors
      (id, campaign_id, name, actor_type, folder_id, sort_order, avatar_url,
       system_json, prototype_token_json, ownership_json, flags_json,
       created_by_user_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, NULL, 0, ?5, ?6, ?7, ?8, '{}', ?9, ?10, ?10)`,
  ).bind(
    id, access.campaignId, name, actorType, avatar,
    JSON.stringify(system), JSON.stringify(prototypeToken), JSON.stringify(ownership),
    access.userId, now,
  ).run();
  return {
    id, campaignId: access.campaignId, type: 'actor', name, actorType,
    avatar, system, prototypeToken, folderId: null, sort: 0, ownership,
    flags: {}, createdByUserId: access.userId, createdAt: now, updatedAt: now,
  };
}

export async function updateActor(
  env: Env,
  access: RoomAccess,
  actorId: string,
  input: Record<string, unknown>,
): Promise<ActorDocument> {
  const actor = await requireActor(env, access, actorId);
  const viewer = documentViewer(access);
  if (!canUpdateDocument(actor.ownership, viewer)) throw new HttpError(403, 'FORBIDDEN', '没有角色编辑权限');
  const name = input.name === undefined ? actor.name : nonEmptyText(input.name, '角色名称', 120);
  const avatar = input.avatar === undefined ? actor.avatar : optionalText(input.avatar, '角色头像', 500) ?? '';
  const system = input.system === undefined ? actor.system : jsonObject(input.system, '角色数据', 64 * 1024);
  const prototypeToken = input.prototypeToken === undefined
    ? actor.prototypeToken
    : prototypeTokenInput(input.prototypeToken, name, avatar);
  const ownership = input.ownership === undefined
    ? actor.ownership
    : moderatorOwnership(access, input.ownership);
  const folderId = input.folderId === undefined
    ? actor.folderId
    : input.folderId === null ? null : nonEmptyText(input.folderId, '角色目录', 180);
  if (folderId) await requireFolder(env, access, 'actor', folderId);
  const sort = optionalSort(input.sort, actor.sort);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE actors
        SET name = ?1, avatar_url = ?2, system_json = ?3,
            prototype_token_json = ?4, ownership_json = ?5, folder_id = ?6,
            sort_order = ?7, updated_at = ?8
      WHERE id = ?9 AND campaign_id = ?10 AND deleted_at IS NULL`,
  ).bind(
    name, avatar, JSON.stringify(system), JSON.stringify(prototypeToken),
    JSON.stringify(ownership), folderId, sort, now, actorId, access.campaignId,
  ).run();
  return { ...actor, name, avatar, system, prototypeToken, ownership, folderId, sort, updatedAt: now };
}

export async function deleteActor(env: Env, access: RoomAccess, actorId: string): Promise<void> {
  const actor = await requireActor(env, access, actorId);
  if (!canUpdateDocument(actor.ownership, documentViewer(access))) throw new HttpError(403, 'FORBIDDEN', '没有角色删除权限');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE actors SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND campaign_id = ?3 AND deleted_at IS NULL').bind(now, actorId, access.campaignId),
    env.DB.prepare("UPDATE actor_claims SET status = 'released', released_at = ?1 WHERE actor_id = ?2 AND status = 'active'").bind(now, actorId),
  ]);
}

export async function claimActor(env: Env, access: RoomAccess, actorId: string): Promise<ActorClaim> {
  if (access.role !== 'player') {
    throw new HttpError(403, 'FORBIDDEN', '当前身份不能认领角色');
  }
  const actor = await requireActor(env, access, actorId);
  if (!canUpdateDocument(actor.ownership, documentViewer(access))) {
    throw new HttpError(403, 'FORBIDDEN', '只有角色所有者可以认领该角色');
  }
  const occupied = await env.DB.prepare(
    `SELECT user_id FROM actor_claims
      WHERE room_id = ?1 AND actor_id = ?2 AND status = 'active'`,
  ).bind(access.roomId, actorId).first<{ user_id: string }>();
  if (occupied && occupied.user_id !== access.userId) throw new HttpError(409, 'ACTOR_CLAIMED', '该角色已被其他玩家认领');

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE actor_claims SET status = 'released', released_at = ?1
        WHERE room_id = ?2 AND user_id = ?3 AND status = 'active' AND actor_id != ?4`,
    ).bind(now, access.roomId, access.userId, actorId),
    env.DB.prepare(
      `INSERT INTO actor_claims
        (room_id, actor_id, user_id, room_member_id, status, claimed_at, released_at)
       VALUES (?1, ?2, ?3, ?4, 'active', ?5, NULL)
       ON CONFLICT(room_id, actor_id) DO UPDATE SET
         user_id = excluded.user_id,
         room_member_id = excluded.room_member_id,
         status = 'active',
         claimed_at = excluded.claimed_at,
         released_at = NULL`,
    ).bind(access.roomId, actorId, access.userId, access.memberId, now),
  ]);
  return { roomId: access.roomId, actorId, userId: access.userId, claimedAt: now };
}

export async function releaseActor(env: Env, access: RoomAccess, actorId: string): Promise<void> {
  const claim = await env.DB.prepare(
    `SELECT user_id FROM actor_claims
      WHERE room_id = ?1 AND actor_id = ?2 AND status = 'active'`,
  ).bind(access.roomId, actorId).first<{ user_id: string }>();
  if (!claim) return;
  if (claim.user_id !== access.userId && !isRoomModerator(access.role)) {
    throw new HttpError(403, 'FORBIDDEN', '不能释放其他玩家的角色');
  }
  await env.DB.prepare(
    `UPDATE actor_claims SET status = 'released', released_at = ?1
      WHERE room_id = ?2 AND actor_id = ?3 AND status = 'active'`,
  ).bind(Date.now(), access.roomId, actorId).run();
}

export async function listJournals(env: Env, access: RoomAccess): Promise<JournalEntryDocument[]> {
  const journals = await env.DB.prepare(
    `SELECT id, campaign_id, name, folder_id, sort_order, ownership_json,
            flags_json, created_by_user_id, created_at, updated_at
       FROM journal_entries
      WHERE campaign_id = ?1 AND deleted_at IS NULL
      ORDER BY folder_id, sort_order, name`,
  ).bind(access.campaignId).all<JournalRow>();
  const ids = journals.results.map(row => row.id);
  const pages = ids.length
    ? await env.DB.prepare(
      `SELECT p.id, p.journal_id, p.name, p.page_type, p.sort_order,
              p.text_content, p.asset_url, p.flags_json, p.created_at, p.updated_at
         FROM journal_pages p
         JOIN journal_entries j ON j.id = p.journal_id
        WHERE j.campaign_id = ?1 AND j.deleted_at IS NULL AND p.deleted_at IS NULL
        ORDER BY p.journal_id, p.sort_order, p.created_at`,
    ).bind(access.campaignId).all<PageRow>()
    : { results: [] as PageRow[] };
  const byJournal = new Map<string, JournalPage[]>();
  for (const row of pages.results) {
    const collection = byJournal.get(row.journal_id) ?? [];
    collection.push(pageFromRow(row));
    byJournal.set(row.journal_id, collection);
  }
  const viewer = documentViewer(access);
  return journals.results.flatMap(row => {
    const journal = journalFromRow(row, byJournal.get(row.id) ?? []);
    if (!canSeeDocument(journal.ownership, viewer)) return [];
    if (!canReadDocument(journal.ownership, viewer)) return [{ ...journal, pages: [] }];
    return [projectJournal(journal, viewer)];
  });
}

export async function createJournal(env: Env, access: RoomAccess, input: Record<string, unknown>): Promise<JournalEntryDocument> {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以创建日志');
  const name = nonEmptyText(input.name, '日志名称', 160);
  const ownership = ownershipInput(input.ownership);
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO journal_entries
      (id, campaign_id, name, folder_id, sort_order, ownership_json, flags_json,
       created_by_user_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, NULL, 0, ?4, '{}', ?5, ?6, ?6)`,
  ).bind(id, access.campaignId, name, JSON.stringify(ownership), access.userId, now).run();
  return {
    id, campaignId: access.campaignId, type: 'journal', name, folderId: null,
    sort: 0, ownership, flags: {}, pages: [], createdByUserId: access.userId,
    createdAt: now, updatedAt: now,
  };
}

export async function updateJournal(
  env: Env,
  access: RoomAccess,
  journalId: string,
  input: Record<string, unknown>,
): Promise<JournalEntryDocument> {
  const journal = await requireJournal(env, access, journalId);
  if (!canUpdateDocument(journal.ownership, documentViewer(access))) throw new HttpError(403, 'FORBIDDEN', '没有日志编辑权限');
  const name = input.name === undefined ? journal.name : nonEmptyText(input.name, '日志名称', 160);
  const ownership = input.ownership === undefined ? journal.ownership : moderatorOwnership(access, input.ownership);
  const folderId = input.folderId === undefined
    ? journal.folderId
    : input.folderId === null ? null : nonEmptyText(input.folderId, '日志目录', 180);
  if (folderId) await requireFolder(env, access, 'journal', folderId);
  const sort = optionalSort(input.sort, journal.sort);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE journal_entries SET name = ?1, ownership_json = ?2, folder_id = ?3, sort_order = ?4, updated_at = ?5
      WHERE id = ?6 AND campaign_id = ?7 AND deleted_at IS NULL`,
  ).bind(name, JSON.stringify(ownership), folderId, sort, now, journalId, access.campaignId).run();
  return { ...journal, name, ownership, folderId, sort, updatedAt: now };
}

export async function createJournalPage(
  env: Env,
  access: RoomAccess,
  journalId: string,
  input: Record<string, unknown>,
): Promise<JournalPage> {
  const journal = await requireJournal(env, access, journalId);
  if (!canUpdateDocument(journal.ownership, documentViewer(access))) throw new HttpError(403, 'FORBIDDEN', '没有日志编辑权限');
  const name = nonEmptyText(input.name, '页面名称', 160);
  const type = journalPageType(input.type ?? 'markdown');
  const text = typeof input.text === 'string' ? input.text.slice(0, 256 * 1024) : '';
  const assetUrl = optionalText(input.assetUrl, '附件地址', 500) ?? null;
  if (type !== 'markdown' && !assetUrl) throw new HttpError(400, 'INVALID_INPUT', '图片、PDF 或手册页面需要附件');
  const id = crypto.randomUUID();
  const now = Date.now();
  const sort = journal.pages.length;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO journal_pages
        (id, journal_id, name, page_type, sort_order, text_content, asset_url,
         flags_json, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '{}', ?8, ?8)`,
    ).bind(id, journalId, name, type, sort, text, assetUrl, now),
    env.DB.prepare('UPDATE journal_entries SET updated_at = ?1 WHERE id = ?2').bind(now, journalId),
  ]);
  return { id, journalId, name, type, sort, text, assetUrl, flags: {}, createdAt: now, updatedAt: now };
}

export async function updateJournalPage(
  env: Env,
  access: RoomAccess,
  journalId: string,
  pageId: string,
  input: Record<string, unknown>,
): Promise<JournalPage> {
  const journal = await requireJournal(env, access, journalId);
  if (!canUpdateDocument(journal.ownership, documentViewer(access))) throw new HttpError(403, 'FORBIDDEN', '没有日志编辑权限');
  const page = journal.pages.find(item => item.id === pageId);
  if (!page) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '找不到日志页面');
  const name = input.name === undefined ? page.name : nonEmptyText(input.name, '页面名称', 160);
  const text = input.text === undefined ? page.text : typeof input.text === 'string' ? input.text.slice(0, 256 * 1024) : '';
  const assetUrl = input.assetUrl === undefined ? page.assetUrl : optionalText(input.assetUrl, '附件地址', 500) ?? null;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE journal_pages SET name = ?1, text_content = ?2, asset_url = ?3, updated_at = ?4
        WHERE id = ?5 AND journal_id = ?6 AND deleted_at IS NULL`,
    ).bind(name, text, assetUrl, now, pageId, journalId),
    env.DB.prepare('UPDATE journal_entries SET updated_at = ?1 WHERE id = ?2').bind(now, journalId),
  ]);
  return { ...page, name, text, assetUrl, updatedAt: now };
}

export async function deleteJournal(env: Env, access: RoomAccess, journalId: string): Promise<void> {
  const journal = await requireJournal(env, access, journalId);
  if (!canUpdateDocument(journal.ownership, documentViewer(access))) throw new HttpError(403, 'FORBIDDEN', '没有日志编辑权限');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE journal_entries SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2').bind(now, journalId),
    env.DB.prepare('UPDATE journal_pages SET deleted_at = ?1, updated_at = ?1 WHERE journal_id = ?2 AND deleted_at IS NULL').bind(now, journalId),
    env.DB.prepare('UPDATE scene_notes SET deleted_at = ?1, updated_at = ?1 WHERE journal_id = ?2 AND deleted_at IS NULL').bind(now, journalId),
  ]);
}

export async function listSceneNotes(env: Env, access: RoomAccess, sceneId: string): Promise<MapNote[]> {
  const result = await env.DB.prepare(
    `SELECT n.id, n.scene_id, n.journal_id, n.page_id, n.x, n.y, n.label,
            n.icon, n.visibility, n.flags_json, j.ownership_json
       FROM scene_notes n
       JOIN journal_entries j ON j.id = n.journal_id AND j.deleted_at IS NULL
      WHERE n.room_id = ?1 AND n.scene_id = ?2 AND n.deleted_at IS NULL
      ORDER BY n.created_at`,
  ).bind(access.roomId, sceneId).all<NoteRow>();
  const viewer = documentViewer(access);
  return result.results.flatMap(row => {
    const ownership = parseOwnership(row.ownership_json);
    if (row.visibility === 'gm' && !isRoomModerator(access.role) && !access.platformOwner) return [];
    if (row.visibility === 'inherit' && !canSeeDocument(ownership, viewer)) return [];
    return [noteFromRow(row)];
  });
}

export async function createSceneNote(
  env: Env,
  access: RoomAccess,
  sceneId: string,
  input: Record<string, unknown>,
): Promise<MapNote> {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以放置地图标记');
  const journalId = nonEmptyText(input.journalId, '日志 ID', 180);
  const journal = await requireJournal(env, access, journalId);
  const pageId = input.pageId === null || input.pageId === undefined ? null : nonEmptyText(input.pageId, '页面 ID', 180);
  if (pageId && !journal.pages.some(page => page.id === pageId)) throw new HttpError(400, 'INVALID_INPUT', '页面不属于该日志');
  const x = coordinate(input.x, '横坐标');
  const y = coordinate(input.y, '纵坐标');
  const label = optionalText(input.label, '标记名称', 160) ?? journal.name;
  const icon = optionalText(input.icon, '标记图标', 80) ?? 'pin';
  const visibility = noteVisibility(input.visibility ?? 'inherit');
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO scene_notes
      (id, room_id, scene_id, journal_id, page_id, x, y, label, icon,
       visibility, flags_json, created_by_user_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '{}', ?11, ?12, ?12)`,
  ).bind(id, access.roomId, sceneId, journalId, pageId, x, y, label, icon, visibility, access.userId, now).run();
  return { id, sceneId, journalId, pageId, x, y, label, icon, visibility, flags: {} };
}

export async function updateSceneNote(
  env: Env,
  access: RoomAccess,
  sceneId: string,
  noteId: string,
  input: Record<string, unknown>,
): Promise<MapNote> {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以编辑地图标记');
  const current = (await listSceneNotes(env, access, sceneId)).find(note => note.id === noteId);
  if (!current) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '找不到地图标记');
  const x = input.x === undefined ? current.x : coordinate(input.x, '横坐标');
  const y = input.y === undefined ? current.y : coordinate(input.y, '纵坐标');
  const label = input.label === undefined ? current.label : nonEmptyText(input.label, '标记名称', 160);
  const visibility = input.visibility === undefined ? current.visibility : noteVisibility(input.visibility);
  const result = await env.DB.prepare(
    `UPDATE scene_notes SET x = ?1, y = ?2, label = ?3, visibility = ?4, updated_at = ?5
      WHERE id = ?6 AND room_id = ?7 AND scene_id = ?8 AND deleted_at IS NULL`,
  ).bind(x, y, label, visibility, Date.now(), noteId, access.roomId, sceneId).run();
  if (result.meta.changes !== 1) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '找不到地图标记');
  return { ...current, x, y, label, visibility };
}

export async function deleteSceneNote(env: Env, access: RoomAccess, sceneId: string, noteId: string): Promise<void> {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以删除地图标记');
  const result = await env.DB.prepare(
    `UPDATE scene_notes SET deleted_at = ?1, updated_at = ?1
      WHERE id = ?2 AND room_id = ?3 AND scene_id = ?4 AND deleted_at IS NULL`,
  ).bind(Date.now(), noteId, access.roomId, sceneId).run();
  if (result.meta.changes !== 1) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '找不到地图标记');
}

export async function listMacros(env: Env, access: RoomAccess): Promise<MacroDocument[]> {
  const result = await env.DB.prepare(
    `SELECT id, campaign_id, name, folder_id, sort_order, command_json, icon,
            ownership_json, flags_json, created_by_user_id, created_at, updated_at
       FROM macros
      WHERE campaign_id = ?1 AND deleted_at IS NULL
      ORDER BY folder_id, sort_order, name`,
  ).bind(access.campaignId).all<MacroRow>();
  const viewer = documentViewer(access);
  return result.results.flatMap(row => {
    const macro = macroFromRow(row);
    return canReadDocument(macro.ownership, viewer) ? [projectMacro(macro, viewer)] : [];
  });
}

export async function createMacro(env: Env, access: RoomAccess, input: Record<string, unknown>): Promise<MacroDocument> {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以创建宏');
  const name = nonEmptyText(input.name, '宏名称', 120);
  const command = macroCommandInput(input.command);
  const ownership = ownershipInput(input.ownership);
  const icon = optionalText(input.icon, '宏图标', 500) ?? '';
  const folderId = input.folderId === undefined || input.folderId === null || input.folderId === ''
    ? null : nonEmptyText(input.folderId, '宏目录', 180);
  if (folderId) await requireFolder(env, access, 'macro', folderId);
  const sort = optionalSort(input.sort, 0);
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO macros
      (id, campaign_id, name, folder_id, sort_order, command_json, icon,
       ownership_json, flags_json, created_by_user_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '{}', ?9, ?10, ?10)`,
  ).bind(id, access.campaignId, name, folderId, sort, JSON.stringify(command), icon, JSON.stringify(ownership), access.userId, now).run();
  return {
    id, campaignId: access.campaignId, type: 'macro', name, command, icon,
    folderId, sort, ownership, flags: {}, createdByUserId: access.userId,
    createdAt: now, updatedAt: now,
  };
}

export async function updateMacro(
  env: Env,
  access: RoomAccess,
  macroId: string,
  input: Record<string, unknown>,
): Promise<MacroDocument> {
  const macro = await requireMacro(env, access, macroId);
  if (!canUpdateDocument(macro.ownership, documentViewer(access))) throw new HttpError(403, 'FORBIDDEN', '没有宏编辑权限');
  const name = input.name === undefined ? macro.name : nonEmptyText(input.name, '宏名称', 120);
  const command = input.command === undefined ? macro.command : macroCommandInput(input.command);
  const icon = input.icon === undefined ? macro.icon : optionalText(input.icon, '宏图标', 500) ?? '';
  const ownership = input.ownership === undefined ? macro.ownership : moderatorOwnership(access, input.ownership);
  const folderId = input.folderId === undefined
    ? macro.folderId
    : input.folderId === null || input.folderId === '' ? null : nonEmptyText(input.folderId, '宏目录', 180);
  if (folderId) await requireFolder(env, access, 'macro', folderId);
  const sort = optionalSort(input.sort, macro.sort);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE macros SET name = ?1, folder_id = ?2, sort_order = ?3, command_json = ?4,
            icon = ?5, ownership_json = ?6, updated_at = ?7
      WHERE id = ?8 AND campaign_id = ?9 AND deleted_at IS NULL`,
  ).bind(name, folderId, sort, JSON.stringify(command), icon, JSON.stringify(ownership), now, macroId, access.campaignId).run();
  return { ...macro, name, folderId, sort, command, icon, ownership, updatedAt: now };
}

export async function deleteMacro(env: Env, access: RoomAccess, macroId: string): Promise<void> {
  const macro = await requireMacro(env, access, macroId);
  if (!canUpdateDocument(macro.ownership, documentViewer(access))) throw new HttpError(403, 'FORBIDDEN', '没有宏删除权限');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM macro_hotbar_bindings WHERE macro_id = ?1').bind(macroId),
    env.DB.prepare('UPDATE macros SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND campaign_id = ?3 AND deleted_at IS NULL').bind(now, macroId, access.campaignId),
  ]);
}

export async function listMacroHotbar(env: Env, access: RoomAccess): Promise<MacroHotbarBinding[]> {
  const [macros, bindings] = await Promise.all([
    listMacros(env, access),
    env.DB.prepare(
      `SELECT slot, macro_id FROM macro_hotbar_bindings
        WHERE room_id = ?1 AND user_id = ?2 ORDER BY slot`,
    ).bind(access.roomId, access.userId).all<{ slot: number; macro_id: string }>(),
  ]);
  const visible = new Map(macros.map(macro => [macro.id, macro]));
  return bindings.results.flatMap(binding => {
    const macro = visible.get(binding.macro_id);
    return macro ? [{ slot: binding.slot, macro }] : [];
  });
}

export async function setMacroHotbarBinding(
  env: Env,
  access: RoomAccess,
  slot: number,
  macroId: string,
): Promise<MacroHotbarBinding> {
  if (!Number.isInteger(slot) || slot < 1 || slot > 10) throw new HttpError(400, 'INVALID_INPUT', '快捷栏位置无效');
  const macro = await requireMacro(env, access, macroId);
  if (!canReadDocument(macro.ownership, documentViewer(access))) throw new HttpError(403, 'FORBIDDEN', '没有宏执行权限');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM macro_hotbar_bindings WHERE room_id = ?1 AND user_id = ?2 AND macro_id = ?3 AND slot != ?4',
    ).bind(access.roomId, access.userId, macroId, slot),
    env.DB.prepare(
      `INSERT INTO macro_hotbar_bindings (room_id, user_id, slot, macro_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(room_id, user_id, slot) DO UPDATE SET macro_id = excluded.macro_id, created_at = excluded.created_at`,
    ).bind(access.roomId, access.userId, slot, macroId, now),
  ]);
  return { slot, macro: projectMacro(macro, documentViewer(access)) };
}

export async function clearMacroHotbarBinding(env: Env, access: RoomAccess, slot: number): Promise<void> {
  if (!Number.isInteger(slot) || slot < 1 || slot > 10) throw new HttpError(400, 'INVALID_INPUT', '快捷栏位置无效');
  await env.DB.prepare(
    'DELETE FROM macro_hotbar_bindings WHERE room_id = ?1 AND user_id = ?2 AND slot = ?3',
  ).bind(access.roomId, access.userId, slot).run();
}

async function currentActorClaim(env: Env, access: RoomAccess): Promise<ActorClaim | null> {
  const row = await env.DB.prepare(
    `SELECT room_id, actor_id, user_id, claimed_at FROM actor_claims
      WHERE room_id = ?1 AND user_id = ?2 AND status = 'active' LIMIT 1`,
  ).bind(access.roomId, access.userId).first<ClaimRow>();
  return row ? { roomId: row.room_id, actorId: row.actor_id, userId: row.user_id, claimedAt: row.claimed_at } : null;
}

async function requireActor(env: Env, access: RoomAccess, actorId: string): Promise<ActorDocument> {
  const row = await env.DB.prepare(
    `SELECT id, campaign_id, name, actor_type, folder_id, sort_order, avatar_url,
            system_json, prototype_token_json, ownership_json, flags_json,
            created_by_user_id, created_at, updated_at
       FROM actors WHERE id = ?1 AND campaign_id = ?2 AND deleted_at IS NULL`,
  ).bind(actorId, access.campaignId).first<ActorRow>();
  if (!row) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '找不到角色');
  return actorFromRow(row);
}

async function requireJournal(env: Env, access: RoomAccess, journalId: string): Promise<JournalEntryDocument> {
  const row = await env.DB.prepare(
    `SELECT id, campaign_id, name, folder_id, sort_order, ownership_json,
            flags_json, created_by_user_id, created_at, updated_at
       FROM journal_entries WHERE id = ?1 AND campaign_id = ?2 AND deleted_at IS NULL`,
  ).bind(journalId, access.campaignId).first<JournalRow>();
  if (!row) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '找不到日志');
  const pages = await env.DB.prepare(
    `SELECT id, journal_id, name, page_type, sort_order, text_content,
            asset_url, flags_json, created_at, updated_at
       FROM journal_pages WHERE journal_id = ?1 AND deleted_at IS NULL
      ORDER BY sort_order, created_at`,
  ).bind(journalId).all<PageRow>();
  return journalFromRow(row, pages.results.map(pageFromRow));
}

async function requireMacro(env: Env, access: RoomAccess, macroId: string): Promise<MacroDocument> {
  const row = await env.DB.prepare(
    `SELECT id, campaign_id, name, folder_id, sort_order, command_json, icon,
            ownership_json, flags_json, created_by_user_id, created_at, updated_at
       FROM macros WHERE id = ?1 AND campaign_id = ?2 AND deleted_at IS NULL`,
  ).bind(macroId, access.campaignId).first<MacroRow>();
  if (!row) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '找不到宏');
  return macroFromRow(row);
}

async function requireFolder(env: Env, access: RoomAccess, documentType: FolderDocumentType, folderId: string): Promise<DocumentFolder> {
  const row = await env.DB.prepare(
    `SELECT id, campaign_id, document_type, parent_id, name, sort_order, flags_json
       FROM document_folders
      WHERE id = ?1 AND campaign_id = ?2 AND document_type = ?3 AND deleted_at IS NULL`,
  ).bind(folderId, access.campaignId, documentType).first<FolderRow>();
  if (!row) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '找不到目录');
  return folderFromRow(row);
}

function folderFromRow(row: FolderRow): DocumentFolder {
  return {
    id: row.id, campaignId: row.campaign_id, documentType: row.document_type,
    parentId: row.parent_id, name: row.name, sort: row.sort_order, flags: parseFlags(row.flags_json),
  };
}

function actorFromRow(row: ActorRow): ActorDocument {
  const fallback = prototypeTokenInput(undefined, row.name, row.avatar_url);
  return {
    id: row.id, campaignId: row.campaign_id, type: 'actor', name: row.name,
    actorType: row.actor_type, folderId: row.folder_id, sort: row.sort_order,
    avatar: row.avatar_url, system: parseJsonObject(row.system_json),
    prototypeToken: { ...fallback, ...parseJsonObject(row.prototype_token_json) } as ActorPrototypeToken,
    ownership: parseOwnership(row.ownership_json), flags: parseFlags(row.flags_json),
    createdByUserId: row.created_by_user_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function projectActor(actor: ActorDocument, viewer: DocumentViewer): ActorDocument {
  const level = canReadDocument(actor.ownership, viewer);
  if (!level) return { ...actor, system: {}, prototypeToken: { ...actor.prototypeToken, hpVisibility: 'none' }, ownership: visibleOwnership(actor.ownership, viewer) };
  return { ...actor, ownership: visibleOwnership(actor.ownership, viewer) };
}

function journalFromRow(row: JournalRow, pages: JournalPage[]): JournalEntryDocument {
  return {
    id: row.id, campaignId: row.campaign_id, type: 'journal', name: row.name,
    folderId: row.folder_id, sort: row.sort_order, ownership: parseOwnership(row.ownership_json),
    flags: parseFlags(row.flags_json), pages, createdByUserId: row.created_by_user_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function projectJournal(journal: JournalEntryDocument, viewer: DocumentViewer): JournalEntryDocument {
  return { ...journal, ownership: visibleOwnership(journal.ownership, viewer) };
}

function pageFromRow(row: PageRow): JournalPage {
  return {
    id: row.id, journalId: row.journal_id, name: row.name, type: row.page_type,
    sort: row.sort_order, text: row.text_content, assetUrl: row.asset_url,
    flags: parseFlags(row.flags_json), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function noteFromRow(row: NoteRow): MapNote {
  return {
    id: row.id, sceneId: row.scene_id, journalId: row.journal_id, pageId: row.page_id,
    x: row.x, y: row.y, label: row.label, icon: row.icon, visibility: row.visibility,
    flags: parseFlags(row.flags_json),
  };
}

function macroFromRow(row: MacroRow): MacroDocument {
  return {
    id: row.id, campaignId: row.campaign_id, type: 'macro', name: row.name,
    folderId: row.folder_id, sort: row.sort_order, command: macroCommandInput(parseJson(row.command_json)),
    icon: row.icon, ownership: parseOwnership(row.ownership_json), flags: parseFlags(row.flags_json),
    createdByUserId: row.created_by_user_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function projectMacro(macro: MacroDocument, viewer: DocumentViewer): MacroDocument {
  return { ...macro, ownership: visibleOwnership(macro.ownership, viewer) };
}

function visibleOwnership(ownership: DocumentOwnership, viewer: DocumentViewer): DocumentOwnership {
  if (isRoomModerator(viewer.roomRole) || canUpdateDocument(ownership, viewer)) return ownership;
  return { default: ownership.default, users: {} };
}

function documentViewer(access: RoomAccess): DocumentViewer {
  return {
    userId: access.userId,
    roomRole: access.role,
    ...(access.platformOwner && !isRoomModerator(access.role) ? { platformReadOnly: true } : {}),
  };
}

function ownershipInput(value: unknown): DocumentOwnership {
  if (value === undefined) return { default: 'none', users: {} };
  return normalizeDocumentOwnership(value);
}

function moderatorOwnership(access: RoomAccess, value: unknown): DocumentOwnership {
  if (!isRoomModerator(access.role)) throw new HttpError(403, 'FORBIDDEN', '只有主持人可以修改文档权限');
  return ownershipInput(value);
}

function parseOwnership(value: string): DocumentOwnership {
  return normalizeDocumentOwnership(parseJson(value));
}

function parseFlags(value: string): DocumentFlags {
  return parseJsonObject(value) as DocumentFlags;
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}

function parseJsonObject(value: string): Record<string, JsonValue> {
  const parsed = parseJson(value);
  return isRecord(parsed) ? parsed as Record<string, JsonValue> : {};
}

function jsonObject(value: unknown, label: string, maximumBytes: number): Record<string, JsonValue> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new HttpError(400, 'INVALID_INPUT', `${label}必须是对象`);
  const encoded = JSON.stringify(value);
  if (encoded.length > maximumBytes) throw new HttpError(400, 'INVALID_INPUT', `${label}过大`);
  return value as Record<string, JsonValue>;
}

function actorDocumentType(value: unknown): ActorDocumentType {
  if (value === 'character' || value === 'npc' || value === 'monster') return value;
  throw new HttpError(400, 'INVALID_INPUT', '角色类型无效');
}

function folderDocumentType(value: unknown): FolderDocumentType {
  if (value === 'actor' || value === 'journal' || value === 'macro') return value;
  throw new HttpError(400, 'INVALID_INPUT', '目录文档类型无效');
}

function optionalSort(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > 1_000_000) {
    throw new HttpError(400, 'INVALID_INPUT', '排序值无效');
  }
  return value;
}

function journalPageType(value: unknown): JournalPageType {
  if (value === 'markdown' || value === 'image' || value === 'pdf' || value === 'handout') return value;
  throw new HttpError(400, 'INVALID_INPUT', '日志页面类型无效');
}

function noteVisibility(value: unknown): MapNote['visibility'] {
  if (value === 'inherit' || value === 'gm' || value === 'all') return value;
  throw new HttpError(400, 'INVALID_INPUT', '地图标记可见性无效');
}

function prototypeTokenInput(value: unknown, name: string, avatar: string): ActorPrototypeToken {
  const input = isRecord(value) ? value : {};
  return {
    name: optionalText(input.name, 'Token 名称', 120) ?? name,
    avatar: optionalText(input.avatar, 'Token 头像', 500) ?? avatar,
    color: optionalText(input.color, 'Token 颜色', 40) ?? '#38a169',
    size: boundedNumber(input.size, DEFAULT_TOKEN_SIZE, 24, 600, 'Token 大小'),
    hidden: typeof input.hidden === 'boolean' ? input.hidden : false,
    hpVisibility: input.hpVisibility === 'none' || input.hpVisibility === 'bar' || input.hpVisibility === 'value'
      ? input.hpVisibility : 'value',
  };
}

function macroCommandInput(value: unknown): MacroCommand {
  if (!isRecord(value)) throw new HttpError(400, 'INVALID_INPUT', '宏命令无效');
  const commandId = nonEmptyText(value.commandId, '命令 ID', 160);
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(commandId)) {
    throw new HttpError(400, 'INVALID_INPUT', '命令 ID 必须使用扩展命名空间');
  }
  const args = jsonObject(value.args, '宏参数', 8 * 1024);
  return { commandId, args };
}

function optionalText(value: unknown, label: string, maximumLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return nonEmptyText(value, label, maximumLength);
}

function coordinate(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100_000) {
    throw new HttpError(400, 'INVALID_INPUT', `${label}无效`);
  }
  return value;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HttpError(400, 'INVALID_INPUT', `${label}无效`);
  }
  return value;
}
