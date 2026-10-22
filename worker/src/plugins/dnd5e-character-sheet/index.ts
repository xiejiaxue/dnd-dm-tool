import {
  DND5E_CHARACTER_SHEET_PLUGIN_ID,
  deriveDnd5eCharacter,
  fallbackCharacterRuleCatalog,
  normalizeCharacterRuleCatalog,
  normalizeDnd5eCharacterSheet,
  personalCharacterActorSystemFromDerived,
  recalculateDnd5eCharacterSheet,
  type PersonalCharacter,
} from '../../../../shared/plugins/dnd5e-character-sheet';
import type { Session } from '../../auth';
import { HttpError, isRecord, json, nonEmptyText, readJsonObject } from '../../http';
import type { RoomAccess } from '../../repository';
import { claimActor, createActor } from '../../world-documents';

const RULE_CATALOG_KEY = 'compendium/books/character-options.json';
const MAX_PERSONAL_CHARACTERS = 30;
const MAX_SHEET_BYTES = 128 * 1024;

interface CharacterRow {
  id: string;
  owner_user_id: string;
  name: string;
  color: string;
  sheet_json: string;
  status: 'active' | 'retired';
  created_at: number;
  updated_at: number;
}

/** Namespace-owned API route. Core only delegates /api/plugins/:id here. */
export async function routeCharacterSheetPlugin(
  request: Request,
  env: Env,
  session: Session,
  rest: string[],
): Promise<Response> {
  if (rest.length === 1 && rest[0] === 'rules' && request.method === 'GET') {
    return json(await loadCharacterRuleCatalog(env), { headers: { 'cache-control': 'private, max-age=300' } });
  }
  if (rest[0] !== 'characters') throw new HttpError(404, 'NOT_FOUND', '找不到角色卡插件接口');
  if (rest.length === 1 && request.method === 'GET') return json({ characters: await listPersonalCharacters(env, session.userId) });
  if (rest.length === 1 && request.method === 'POST') {
    return json(await createPersonalCharacter(env, session.userId, await readJsonObject(request, MAX_SHEET_BYTES + 4096)), { status: 201 });
  }
  if (rest.length === 2 && request.method === 'GET') return json(await requirePersonalCharacter(env, session.userId, rest[1]));
  if (rest.length === 2 && request.method === 'PATCH') {
    return json(await updatePersonalCharacter(env, session.userId, rest[1], await readJsonObject(request, MAX_SHEET_BYTES + 4096)));
  }
  if (rest.length === 2 && request.method === 'DELETE') {
    await deletePersonalCharacter(env, session.userId, rest[1]);
    return json({ ok: true });
  }
  throw new HttpError(404, 'NOT_FOUND', '找不到角色卡插件接口');
}

/** Room bridge is deliberately narrow: only players may list/import their own cards. */
export async function routeRoomCharacterSheetPlugin(
  request: Request,
  env: Env,
  access: RoomAccess,
  rest: string[],
): Promise<Response> {
  requirePlayer(access);
  if (rest.length === 1 && rest[0] === 'characters' && request.method === 'GET') {
    return json({ characters: await listPersonalCharacters(env, access.userId) });
  }
  if (rest.length === 3 && rest[0] === 'characters' && rest[2] === 'import' && request.method === 'POST') {
    const character = await requirePersonalCharacter(env, access.userId, rest[1]);
    const catalog = await loadCharacterRuleCatalog(env);
    character.sheet = recalculateDnd5eCharacterSheet(character.sheet, catalog);
    const derived = deriveDnd5eCharacter(character.sheet, catalog);
    const actor = await createActor(env, access, {
      name: character.name,
      actorType: 'character',
      avatar: character.sheet.identity.avatarUrl,
      system: personalCharacterActorSystemFromDerived(character, derived),
      prototypeToken: {
        name: character.name,
        avatar: character.sheet.identity.avatarUrl,
        color: character.color,
        size: 100,
        hidden: false,
        hpVisibility: 'value',
      },
    });
    const claim = await claimActor(env, access, actor.id);
    return json({ actorId: actor.id, characterId: character.id, claimedAt: claim.claimedAt }, { status: 201 });
  }
  throw new HttpError(404, 'NOT_FOUND', '找不到角色卡房间接口');
}

export async function loadCharacterRuleCatalog(env: Env) {
  const object = await env.REFERENCE_DATA.get(RULE_CATALOG_KEY);
  if (!object) return fallbackCharacterRuleCatalog();
  try {
    return normalizeCharacterRuleCatalog(await object.json());
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'character_rule_catalog_invalid',
      pluginId: DND5E_CHARACTER_SHEET_PLUGIN_ID,
      message: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
    }));
    return fallbackCharacterRuleCatalog();
  }
}

export async function listPersonalCharacters(env: Env, userId: string): Promise<PersonalCharacter[]> {
  const result = await env.DB.prepare(
    `SELECT id, owner_user_id, name, color, sheet_json, status, created_at, updated_at
       FROM characters
      WHERE owner_user_id = ?1 AND deleted_at IS NULL AND status IN ('active', 'retired')
      ORDER BY updated_at DESC, name`,
  ).bind(userId).all<CharacterRow>();
  return result.results.map(characterFromRow);
}

export async function createPersonalCharacter(
  env: Env,
  userId: string,
  input: Record<string, unknown>,
): Promise<PersonalCharacter> {
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM characters
      WHERE owner_user_id = ?1 AND deleted_at IS NULL AND status IN ('active', 'retired')`,
  ).bind(userId).first<{ count: number }>();
  if ((count?.count ?? 0) >= MAX_PERSONAL_CHARACTERS) {
    throw new HttpError(409, 'CHARACTER_LIMIT', `每位用户最多保存 ${MAX_PERSONAL_CHARACTERS} 张角色卡`);
  }
  const requestedName = typeof input.name === 'string'
    ? input.name
    : isRecord(input.sheet) && isRecord(input.sheet.identity) ? input.sheet.identity.characterName : undefined;
  const name = nonEmptyText(requestedName, '角色名称', 120);
  const sheet = recalculateDnd5eCharacterSheet(normalizeDnd5eCharacterSheet(input.sheet, name), await loadCharacterRuleCatalog(env));
  sheet.identity.characterName = name;
  const sheetJson = serializedSheet(sheet);
  const id = crypto.randomUUID();
  const now = Date.now();
  const color = characterColor(input.color);
  await env.DB.prepare(
    `INSERT INTO characters
      (id, owner_user_id, name, avatar_asset_id, color, sheet_json, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'active', ?6, ?6)`,
  ).bind(id, userId, name, color, sheetJson, now).run();
  return { id, ownerUserId: userId, name, color, sheet, status: 'active', createdAt: now, updatedAt: now };
}

export async function updatePersonalCharacter(
  env: Env,
  userId: string,
  characterId: string,
  input: Record<string, unknown>,
): Promise<PersonalCharacter> {
  const current = await requirePersonalCharacter(env, userId, characterId);
  const name = input.name === undefined ? current.name : nonEmptyText(input.name, '角色名称', 120);
  const sheet = input.sheet === undefined
    ? current.sheet
    : recalculateDnd5eCharacterSheet(normalizeDnd5eCharacterSheet(input.sheet, name), await loadCharacterRuleCatalog(env));
  sheet.identity.characterName = name;
  const color = input.color === undefined ? current.color : characterColor(input.color);
  const status = input.status === undefined ? current.status : characterStatus(input.status);
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE characters SET name = ?1, color = ?2, sheet_json = ?3, status = ?4, updated_at = ?5
      WHERE id = ?6 AND owner_user_id = ?7 AND deleted_at IS NULL`,
  ).bind(name, color, serializedSheet(sheet), status, now, characterId, userId).run();
  if (result.meta.changes !== 1) throw new HttpError(404, 'CHARACTER_NOT_FOUND', '找不到角色卡');
  return { ...current, name, color, sheet, status, updatedAt: now };
}

export async function deletePersonalCharacter(env: Env, userId: string, characterId: string): Promise<void> {
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE characters SET status = 'deleted', deleted_at = ?1, updated_at = ?1
      WHERE id = ?2 AND owner_user_id = ?3 AND deleted_at IS NULL`,
  ).bind(now, characterId, userId).run();
  if (result.meta.changes !== 1) throw new HttpError(404, 'CHARACTER_NOT_FOUND', '找不到角色卡');
}

async function requirePersonalCharacter(env: Env, userId: string, characterId: string): Promise<PersonalCharacter> {
  if (!characterId || characterId.length > 180) throw new HttpError(404, 'CHARACTER_NOT_FOUND', '找不到角色卡');
  const row = await env.DB.prepare(
    `SELECT id, owner_user_id, name, color, sheet_json, status, created_at, updated_at
       FROM characters
      WHERE id = ?1 AND owner_user_id = ?2 AND deleted_at IS NULL AND status IN ('active', 'retired')`,
  ).bind(characterId, userId).first<CharacterRow>();
  if (!row) throw new HttpError(404, 'CHARACTER_NOT_FOUND', '找不到角色卡');
  return characterFromRow(row);
}

function characterFromRow(row: CharacterRow): PersonalCharacter {
  let source: unknown;
  try { source = JSON.parse(row.sheet_json) as unknown; }
  catch { source = undefined; }
  const sheet = normalizeDnd5eCharacterSheet(source, row.name);
  sheet.identity.characterName = row.name;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    color: characterColor(row.color),
    sheet,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializedSheet(sheet: ReturnType<typeof normalizeDnd5eCharacterSheet>): string {
  const result = JSON.stringify(sheet);
  if (new TextEncoder().encode(result).byteLength > MAX_SHEET_BYTES) {
    throw new HttpError(413, 'CHARACTER_TOO_LARGE', '角色卡数据过大');
  }
  return result;
}

function characterColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value) ? value.toLocaleLowerCase() : '#38a169';
}

function characterStatus(value: unknown): PersonalCharacter['status'] {
  if (value === 'active' || value === 'retired') return value;
  throw new HttpError(400, 'INVALID_INPUT', '角色卡状态无效');
}

function requirePlayer(access: RoomAccess): void {
  if (access.role !== 'player') {
    throw new HttpError(403, 'PLAYER_ONLY', '角色卡插件只能由当前房间的玩家使用');
  }
}
