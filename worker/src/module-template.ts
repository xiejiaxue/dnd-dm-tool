import { createScene } from './domain';
import { HttpError } from './http';
import type { RoomAccess } from './repository';

export const DRAGON_HEIST = 'waterdeep-dragon-heist';
export const templateAssetPrefix = (campaignId: string) => `v2/campaigns/${campaignId}/templates/${DRAGON_HEIST}/`;
export const TEMPLATE_PREFIX = `room-templates/${DRAGON_HEIST}/`;

/** Only maps and scene names are imported; legacy NPCs and encounters are excluded. */
export async function prepareModuleScenes(env: Env, access: RoomAccess) {
  if (!access.templateId) return undefined;
  if (access.templateId !== DRAGON_HEIST)
    throw new HttpError(503, 'MODULE_UNAVAILABLE', '模组暂不可用');
  const object = await env.REFERENCE_DATA.get(`${TEMPLATE_PREFIX}manifest.json`);
  if (!object) throw new HttpError(503, 'MODULE_UNAVAILABLE', '模组暂不可用');
  const manifest = await object.json<{ scenes: Array<{ name: string; map: { assetId: string; width: number; height: number; mapScale?: number } }> }>();
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length !== 21)
    throw new HttpError(503, 'MODULE_INVALID', '模组场景不完整');
  const scenes = [];
  const assets: D1PreparedStatement[] = [];
  for (const item of manifest.scenes) {
    const map = item.map;
    if (!item.name || !map || !/^map-[a-z0-9-]+$/.test(map.assetId) ||
      !Number.isFinite(map.width) || map.width <= 0 || !Number.isFinite(map.height) || map.height <= 0 ||
      (map.mapScale !== undefined && (!Number.isFinite(map.mapScale) || map.mapScale <= 0)))
      throw new HttpError(503, 'MODULE_INVALID', '模组地图数据无效');
    const key = `${TEMPLATE_PREFIX}assets/${map.assetId}`;
    const metadata = await env.REFERENCE_DATA.head(key);
    if (!metadata) throw new HttpError(503, 'MODULE_INVALID', '模组地图缺失');
    // Campaign-scoped records authorize access; the immutable source image is shared.
    const id = `${access.campaignId}-${map.assetId}`;
    assets.push(env.DB.prepare(`INSERT OR IGNORE INTO assets
      (id,workspace_id,campaign_id,created_by_user_id,kind,visibility,object_key,content_type,byte_size,sha256,metadata_json,created_at)
      VALUES(?1,?2,?3,?4,'map','campaign',?5,?6,?7,'','{}',?8)`)
      .bind(id, access.workspaceId, access.campaignId, access.userId, `${templateAssetPrefix(access.campaignId)}${map.assetId}`,
        metadata.httpMetadata?.contentType || 'image/jpeg', metadata.size, Date.now()));
    const scene = createScene(item.name);
    scene.mapImage = `/api/campaigns/${encodeURIComponent(access.roomSlug)}/assets/${id}`;
    scene.mapSize = [map.width, map.height];
    scene.mapScale = map.mapScale ?? 1;
    scene.playArea = { x: 0, y: 0, w: map.width, h: map.height };
    scenes.push(scene);
  }
  await env.DB.batch(assets);
  return scenes;
}
