import {
  isContentPackageAssetId,
  isContentPackageId,
  parseContentPackageManifest,
  parseContentPackageSummary,
  type ContentPackageManifest,
  type ContentPackageScene,
  type ContentPackageSummary,
  type ContentPackageToken,
} from '../../shared/content-package';
import { createInitialRoomState, createScene, newOpaqueId, type PersistedRoomState } from './domain';
import { HttpError, isRecord } from './http';

const INDEX_KEY = 'room-templates/index.json';

// Compatibility aliases keep the HTTP API and existing room code stable while
// the canonical contract lives in shared/content-package.ts.
export type RoomTemplateSummary = ContentPackageSummary;
export type RoomTemplateScene = ContentPackageScene;
export type RoomTemplateToken = ContentPackageToken;
export type RoomTemplateManifest = ContentPackageManifest;

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
    try { return [parseContentPackageSummary(item)]; } catch { return []; }
  });
}

export async function loadRoomTemplate(env: Env, templateId: string): Promise<RoomTemplateManifest> {
  if (!isContentPackageId(templateId)) throw new HttpError(400, 'INVALID_TEMPLATE', '房间模板无效');
  const object = await env.REFERENCE_DATA.get(`room-templates/${templateId}/manifest.json`);
  if (!object) throw new HttpError(404, 'TEMPLATE_NOT_FOUND', '找不到该房间模板');
  let source: unknown;
  try {
    source = await object.json();
  } catch {
    throw new HttpError(503, 'TEMPLATE_UNAVAILABLE', '房间模板数据暂时不可用');
  }
  try {
    return parseContentPackageManifest(source, templateId);
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
  if (!isContentPackageId(templateId) || !isContentPackageAssetId(assetId)) {
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
