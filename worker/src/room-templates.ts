import type { NpcImportance, NpcRecord, NpcStatus, Token } from '../../shared/types';
import { normalizeNpcMetadata } from '../../shared/npc-metadata';
import { createInitialRoomState, createScene, newOpaqueId, type PersistedRoomState } from './domain';
import { HttpError, isRecord } from './http';

const INDEX_KEY = 'room-templates/index.json';
const TEMPLATE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const ASSET_ID = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u;

export interface RoomTemplateSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  sceneCount: number;
  npcCount: number;
}

export interface RoomTemplateScene {
  key: string;
  name: string;
  chapter: string;
  map: {
    assetId: string;
    width: number;
    height: number;
    contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';
    mapScale: number;
  };
  tokens: RoomTemplateToken[];
  unlocked: boolean;
}

export type RoomTemplateToken = Omit<Token, 'id'>;

export interface RoomTemplateManifest extends RoomTemplateSummary {
  schemaVersion: 1;
  npcs: NpcRecord[];
  scenes: RoomTemplateScene[];
}

export async function listRoomTemplates(env: Env): Promise<RoomTemplateSummary[]> {
  const object = await env.REFERENCE_DATA.get(INDEX_KEY);
  if (!object) return [];
  let value: unknown;
  try {
    value = await object.json();
  } catch {
    console.warn(JSON.stringify({ event: 'room_template_index_invalid', reason: 'invalid_json' }));
    return [];
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.templates)) return [];
  return value.templates.slice(0, 20).flatMap(item => {
    try { return [templateSummary(item)]; } catch { return []; }
  });
}

export async function loadRoomTemplate(env: Env, templateId: string): Promise<RoomTemplateManifest> {
  if (!TEMPLATE_ID.test(templateId)) throw new HttpError(400, 'INVALID_TEMPLATE', '房间模板无效');
  const object = await env.REFERENCE_DATA.get(`room-templates/${templateId}/manifest.json`);
  if (!object) throw new HttpError(404, 'TEMPLATE_NOT_FOUND', '找不到该房间模板');
  let source: unknown;
  try {
    source = await object.json();
  } catch {
    throw new HttpError(503, 'TEMPLATE_UNAVAILABLE', '房间模板数据暂时不可用');
  }
  try {
    return templateManifest(source, templateId);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'room_template_manifest_invalid',
      templateId,
      message: error instanceof Error ? error.message : String(error),
    }));
    throw new HttpError(503, 'TEMPLATE_UNAVAILABLE', '房间模板数据暂时不可用');
  }
}

export function instantiateRoomTemplate(
  roomName: string,
  campaignName: string,
  roomSlug: string,
  template: RoomTemplateManifest,
): PersistedRoomState {
  const state = createInitialRoomState(roomName, campaignName);
  const campaign = state.campaigns[state.currentCampaignId];
  const scenes = template.scenes.map((source) => {
    const scene = createScene(source.name);
    scene.mapImage = `/api/rooms/${encodeURIComponent(roomSlug)}/template-assets/${template.id}/${source.map.assetId}`;
    scene.mapSize = [source.map.width, source.map.height];
    scene.mapScale = source.map.mapScale;
    scene.playArea = { x: 0, y: 0, w: source.map.width, h: source.map.height };
    scene.unlocked = source.unlocked;
    scene.fog = undefined;
    scene.fogReveals = [];
    scene.fogVersion = 2;
    scene.tokens = source.tokens.map(token => ({
      ...token,
      id: newOpaqueId('token'),
      hp: token.hp ? { ...token.hp } : undefined,
    }));
    return scene;
  });
  state.scenes = Object.fromEntries(scenes.map(scene => [scene.id, scene]));
  state.currentSceneId = scenes[0].id;
  campaign.name = campaignName;
  campaign.templateId = template.id;
  campaign.sceneIds = scenes.map(scene => scene.id);
  const folderByChapter = new Map<string, string>();
  campaign.sceneFolders = [];
  campaign.sceneFolderAssignments = {};
  template.scenes.forEach((source, index) => {
    const chapter = source.chapter.trim();
    if (!chapter) return;
    let folderId = folderByChapter.get(chapter);
    if (!folderId) {
      folderId = newOpaqueId('folder');
      folderByChapter.set(chapter, folderId);
      campaign.sceneFolders!.push({ id: folderId, name: chapter });
    }
    campaign.sceneFolderAssignments![scenes[index].id] = folderId;
  });
  campaign.sceneFoldersInitialized = true;
  campaign.npcs = template.npcs.map(npc => ({
    ...npc,
    aliases: [...npc.aliases],
    groupPath: [...(npc.groupPath ?? [])],
    statReference: npc.statReference ? { ...npc.statReference } : undefined,
  }));
  return state;
}

export async function getRoomTemplateAsset(env: Env, templateId: string, assetId: string): Promise<Response> {
  if (!TEMPLATE_ID.test(templateId) || !ASSET_ID.test(assetId)) {
    throw new HttpError(404, 'ASSET_NOT_FOUND', '找不到模板素材');
  }
  const object = await env.REFERENCE_DATA.get(`room-templates/${templateId}/assets/${assetId}`);
  if (!object) throw new HttpError(404, 'ASSET_NOT_FOUND', '找不到模板素材');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // Template asset IDs contain a content digest and therefore never change in
  // place. Members still pass D1 room authorization before this response.
  headers.set('cache-control', 'private, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('content-disposition', 'inline');
  return new Response(object.body, { headers });
}

function templateSummary(value: unknown): RoomTemplateSummary {
  if (!isRecord(value)) throw new Error('template summary must be an object');
  const id = boundedText(value.id, 64);
  if (!TEMPLATE_ID.test(id)) throw new Error('template id is invalid');
  return {
    id,
    name: boundedText(value.name, 120),
    description: optionalText(value.description, 500),
    version: integer(value.version, 1, 1_000_000),
    sceneCount: integer(value.sceneCount, 1, 50),
    npcCount: integer(value.npcCount, 0, 250),
  };
}

function templateManifest(value: unknown, expectedId: string): RoomTemplateManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('unsupported template schema');
  const summary = templateSummary(value);
  if (summary.id !== expectedId) throw new Error('template id mismatch');
  if (!Array.isArray(value.scenes) || value.scenes.length === 0 || value.scenes.length > 50) throw new Error('invalid scenes');
  if (!Array.isArray(value.npcs) || value.npcs.length > 250) throw new Error('invalid npcs');
  const scenes = value.scenes.map(templateScene);
  const npcs = value.npcs.map(templateNpc);
  if (summary.sceneCount !== scenes.length || summary.npcCount !== npcs.length) throw new Error('template counts mismatch');
  return { schemaVersion: 1, ...summary, scenes, npcs };
}

function templateScene(value: unknown): RoomTemplateScene {
  if (!isRecord(value) || !isRecord(value.map)) throw new Error('invalid scene');
  const contentType = value.map.contentType;
  if (contentType !== 'image/jpeg' && contentType !== 'image/png' && contentType !== 'image/webp' && contentType !== 'image/avif') {
    throw new Error('invalid map content type');
  }
  const assetId = boundedText(value.map.assetId, 120);
  if (!ASSET_ID.test(assetId)) throw new Error('invalid asset id');
  const map: RoomTemplateScene['map'] = {
    assetId,
    width: integer(value.map.width, 1, 20_000),
    height: integer(value.map.height, 1, 20_000),
    contentType,
    mapScale: numberIn(value.map.mapScale, 0.1, 8),
  };
  const tokenValues = value.tokens ?? [];
  if (!Array.isArray(tokenValues) || tokenValues.length > 500) throw new Error('invalid scene tokens');
  const tokens = tokenValues.map(templateToken);
  const worldWidth = map.width * map.mapScale;
  const worldHeight = map.height * map.mapScale;
  if (tokens.some(token => token.x + token.size > worldWidth + 0.001 || token.y + token.size > worldHeight + 0.001)) {
    throw new Error('scene token is outside map bounds');
  }
  return {
    key: boundedText(value.key, 120),
    name: boundedText(value.name, 120),
    chapter: optionalText(value.chapter, 120),
    map,
    tokens,
    unlocked: value.unlocked === true,
  };
}

function templateToken(value: unknown): RoomTemplateToken {
  if (!isRecord(value) || (value.kind !== 'monster' && value.kind !== 'npc')) throw new Error('invalid scene token');
  const entryId = value.entryId === null || value.entryId === undefined ? null : boundedText(value.entryId, 180);
  const number = value.number === undefined ? undefined : integer(value.number, 1, 10_000);
  let hp: Token['hp'];
  if (value.hp !== undefined) {
    if (!isRecord(value.hp)) throw new Error('invalid scene token hit points');
    const maximum = integer(value.hp.max, 1, 1_000_000);
    hp = { current: integer(value.hp.current, 0, 1_000_000), max: maximum };
  }
  return {
    kind: value.kind,
    name: boundedText(value.name, 120),
    entryId,
    x: numberIn(value.x, 0, 160_000),
    y: numberIn(value.y, 0, 160_000),
    size: numberIn(value.size, 12, 500),
    avatar: optionalText(value.avatar, 500),
    color: boundedText(value.color, 40),
    ...(number === undefined ? {} : { number }),
    ...(hp ? { hp } : {}),
  };
}

function templateNpc(value: unknown): NpcRecord {
  if (!isRecord(value) || !Array.isArray(value.aliases) || value.aliases.length > 12) throw new Error('invalid npc');
  const status = value.status;
  if (!npcStatus(status)) throw new Error('invalid npc status');
  const sourceFile = value.sourceFile === null || value.sourceFile === undefined ? null : boundedText(value.sourceFile, 180);
  const npc: NpcRecord = {
    id: boundedText(value.id, 180),
    name: boundedText(value.name, 120),
    aliases: value.aliases.map(alias => boundedText(alias, 80)),
    role: optionalText(value.role, 120),
    location: optionalText(value.location, 120),
    status,
    importance: templateNpcImportance(value.importance),
    faction: optionalText(value.faction, 120),
    groupPath: templateNpcGroupPath(value.groupPath),
    statReference: templateNpcStatReference(value.statReference),
    notesMarkdown: optionalText(value.notesMarkdown, 16_000),
    sourceFile,
    updatedAt: numberIn(value.updatedAt, 0, 10_000_000_000_000),
  };
  return normalizeNpcMetadata(npc);
}

function templateNpcGroupPath(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 6) throw new Error('invalid npc group path');
  return value.map(part => boundedText(part, 80));
}

function templateNpcStatReference(value: unknown): NpcRecord['statReference'] {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new Error('invalid npc stat reference');
  if (value.kind === 'custom') return { kind: 'custom' };
  if (value.kind === 'compendium') {
    return {
      kind: 'compendium',
      entryId: boundedText(value.entryId, 180),
      nameZh: boundedText(value.nameZh, 120),
      nameEn: boundedText(value.nameEn, 120),
    };
  }
  if (value.kind === 'npc') {
    return { kind: 'npc', npcId: boundedText(value.npcId, 180), name: boundedText(value.name, 120) };
  }
  throw new Error('invalid npc stat reference');
}

function npcStatus(value: unknown): value is NpcStatus {
  return value === 'active' || value === 'missing' || value === 'inactive' || value === 'dead';
}

function templateNpcImportance(value: unknown): NpcImportance | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'major' || value === 'supporting' || value === 'minor') return value;
  throw new Error('invalid npc importance');
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') throw new Error('expected text');
  const result = value.trim();
  if (!result || result.length > maximum) throw new Error('text length is invalid');
  return result;
}

function optionalText(value: unknown, maximum: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new Error('expected optional text');
  const result = value.trim();
  if (result.length > maximum) throw new Error('text length is invalid');
  return result;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new Error('invalid integer');
  return value;
}

function numberIn(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error('invalid number');
  return value;
}
