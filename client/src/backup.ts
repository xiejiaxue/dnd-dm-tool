import { MAX_FOG_REVEAL_RECTS } from '../../shared/fog-rects';
import type { Campaign, Favorite, FogRect, NpcRecord, NpcStatus, Scene, Token } from './types';

export const SCENE_BACKUP_FORMAT = 'dnd-dm-tool.scene-backup';
export const SCENE_BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 60 * 1024 * 1024;

const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_ASSET_BASE64_LENGTH = Math.ceil(MAX_ASSET_BYTES * 4 / 3) + 8;
const MAX_FOG_CELLS = 2_000_000;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

type ImageType = typeof IMAGE_TYPES[number];

export interface BackupAsset {
  name: string;
  type: ImageType;
  /** Base64 payload. Assets are embedded so a backup can move between rooms. */
  data: string;
}

export interface BackupToken {
  kind?: 'monster' | 'npc';
  name: string;
  entryId: string | null;
  x: number;
  y: number;
  size: number;
  color: string;
  hp?: { current: number; max: number };
  avatarAssetId?: string;
}

export interface SceneBackup {
  format: typeof SCENE_BACKUP_FORMAT;
  version: typeof SCENE_BACKUP_VERSION;
  exportedAt: string;
  scene: {
    name: string;
    mapSize: [number, number];
    mapScale: number;
    mapAssetId?: string;
    // Coordinate snapping remains part of a board. The old visibility field is
    // intentionally not serialized because grids are no longer rendered.
    grid: { size: number; offset: [number, number]; snap: boolean };
    playArea: { x: number; y: number; w: number; h: number };
    tokens: BackupToken[];
    walls: Array<{ p1: [number, number]; p2: [number, number] }>;
    favorites: Favorite[];
    fog?: boolean[];
    fogReveals?: FogRect[];
    unlocked: boolean;
  };
  assets: Record<string, BackupAsset>;
  campaign?: { name: string; enemies: Array<{ entryId: string; nameZh: string }>; npcs?: NpcRecord[] };
}

export interface BuiltSceneBackup {
  backup: SceneBackup;
  skippedAssetCount: number;
}

function isImageType(value: string): value is ImageType {
  return (IMAGE_TYPES as readonly string[]).includes(value);
}

function extensionFor(type: ImageType): string {
  return type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length);
}

function fileName(name: string, type: ImageType): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'asset';
  return cleaned.includes('.') ? cleaned : `${cleaned}.${extensionFor(type)}`;
}

function assetUrlIsSafe(url: string): boolean {
  try {
    const parsed = new URL(url, location.origin);
    return parsed.origin === location.origin && /^\/api\/rooms\/[^/]+\/assets\/[^/]+$/u.test(parsed.pathname);
  } catch {
    return false;
  }
}

function base64FromBytes(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return btoa(chunks.join(''));
}

async function captureAsset(url: string, suggestedName: string): Promise<BackupAsset | null> {
  if (!assetUrlIsSafe(url)) return null;
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`无法读取素材（${response.status}）`);
  const blob = await response.blob();
  const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || blob.type;
  if (!isImageType(type)) throw new Error('素材不是支持的图片类型');
  if (blob.size <= 0 || blob.size > MAX_ASSET_BYTES) throw new Error('素材大于可移植备份的 10 MiB 上限');
  return {
    name: fileName(suggestedName, type),
    type,
    data: base64FromBytes(new Uint8Array(await blob.arrayBuffer())),
  };
}

/** Create a portable, current-scene backup. Player identities and initiative
 * are intentionally omitted: both are server-owned and cannot be safely moved
 * into another room by a browser snapshot. */
export async function buildSceneBackup(scene: Scene, campaign: Campaign | null): Promise<BuiltSceneBackup> {
  const assets: Record<string, BackupAsset> = {};
  const cachedAssets = new Map<string, Promise<string | undefined>>();
  let skippedAssetCount = 0;

  const assetIdFor = (url: string, suggestedName: string): Promise<string | undefined> => {
    const cached = cachedAssets.get(url);
    if (cached) return cached;
    const next = captureAsset(url, suggestedName)
      .then(asset => {
        if (!asset) return undefined;
        const id = `asset-${Object.keys(assets).length + 1}`;
        assets[id] = asset;
        return id;
      })
      .catch(() => {
        skippedAssetCount += 1;
        return undefined;
      });
    cachedAssets.set(url, next);
    return next;
  };

  const mapAssetId = scene.mapImage ? await assetIdFor(scene.mapImage, 'map') : undefined;
  const tokens: BackupToken[] = [];
  for (const [index, token] of scene.tokens.entries()) {
    const avatarAssetId = token.avatar ? await assetIdFor(token.avatar, `token-${index + 1}`) : undefined;
    tokens.push({
      kind: token.kind === 'npc' ? 'npc' : 'monster',
      name: token.name,
      entryId: token.entryId,
      x: token.x,
      y: token.y,
      size: token.size,
      color: token.color,
      ...(token.hp ? { hp: { ...token.hp } } : {}),
      ...(avatarAssetId ? { avatarAssetId } : {}),
    });
  }

  return {
    backup: {
      format: SCENE_BACKUP_FORMAT,
      version: SCENE_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      scene: {
        name: scene.name,
        mapSize: [...scene.mapSize] as [number, number],
        mapScale: scene.mapScale ?? 1,
        ...(mapAssetId ? { mapAssetId } : {}),
        grid: { size: scene.grid.size, offset: [...scene.grid.offset] as [number, number], snap: scene.grid.snap },
        playArea: { ...scene.playArea },
        tokens,
        walls: scene.walls.map(wall => ({
          p1: [...wall.p1] as [number, number],
          p2: [...wall.p2] as [number, number],
        })),
        favorites: scene.favorites.map(favorite => ({ ...favorite })),
        ...(scene.fog ? { fog: [...scene.fog] } : {}),
        ...(scene.fogReveals ? { fogReveals: scene.fogReveals.map(rect => ({ ...rect })) } : {}),
        unlocked: Boolean(scene.unlocked),
      },
      assets,
      ...(campaign ? {
        campaign: {
          name: campaign.name,
          enemies: campaign.enemies.map(enemy => ({ ...enemy })),
          npcs: (campaign.npcs ?? []).map(npc => ({
            ...npc,
            aliases: [...npc.aliases],
            groupPath: [...(npc.groupPath ?? [])],
            statReference: npc.statReference ? { ...npc.statReference } : undefined,
          })),
        },
      } : {}),
    },
    skippedAssetCount,
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是文本`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new Error(`${label}长度无效`);
  return trimmed;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : text(value, label, maxLength);
}

function looseText(value: unknown, label: string, maxLength: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new Error(`${label}必须是文本`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${label}长度无效`);
  return trimmed;
}

function numberIn(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}数值无效`);
  return value;
}

function pair(value: unknown, label: string, min: number, max: number): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label}格式无效`);
  return [numberIn(value[0], label, min, max), numberIn(value[1], label, min, max)];
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`);
  return value;
}

function assetId(value: unknown, assets: Record<string, BackupAsset>, label: string): string | undefined {
  const id = optionalText(value, label, 120);
  if (id && !assets[id]) throw new Error(`${label}引用了不存在的素材`);
  return id;
}

function parseAsset(value: unknown): BackupAsset {
  const input = record(value, '素材');
  const name = text(input.name, '素材文件名', 120);
  const type = text(input.type, '素材类型', 40).toLowerCase();
  if (!isImageType(type)) throw new Error('不支持的素材类型');
  const data = text(input.data, '素材数据', MAX_ASSET_BASE64_LENGTH);
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(data) || Math.floor(data.length * 3 / 4) > MAX_ASSET_BYTES) {
    throw new Error('素材数据无效或过大');
  }
  return { name: fileName(name, type), type, data };
}

function parseToken(value: unknown, assets: Record<string, BackupAsset>): BackupToken {
  const input = record(value, 'Token');
  const color = text(input.color, 'Token 颜色', 32);
  if (!/^#[0-9a-fA-F]{3,8}$|^rgba?\([0-9.,\s%]+\)$/u.test(color)) throw new Error('Token 颜色无效');
  let hp: BackupToken['hp'];
  if (input.hp !== undefined) {
    const inputHp = record(input.hp, 'HP');
    hp = {
      current: numberIn(inputHp.current, '当前 HP', -10_000, 100_000),
      max: numberIn(inputHp.max, '最大 HP', 1, 100_000),
    };
  }
  const rawEntryId = input.entryId;
  if (rawEntryId !== null && typeof rawEntryId !== 'string') throw new Error('条目 ID 无效');
  const entryId = rawEntryId === null ? null : text(rawEntryId, '条目 ID', 180);
  const avatarAssetId = assetId(input.avatarAssetId, assets, '头像素材');
  const kind = input.kind === undefined || input.kind === 'monster' ? 'monster' : input.kind === 'npc' ? 'npc' : null;
  if (!kind) throw new Error('Token 类型无效');
  return {
    kind,
    name: text(input.name, 'Token 名称', 120),
    entryId,
    x: numberIn(input.x, 'Token X 坐标', -100_000, 100_000),
    y: numberIn(input.y, 'Token Y 坐标', -100_000, 100_000),
    size: numberIn(input.size, 'Token 尺寸', 12, 500),
    color,
    ...(hp ? { hp } : {}),
    ...(avatarAssetId ? { avatarAssetId } : {}),
  };
}

function parseNpc(value: unknown): NpcRecord {
  const input = record(value, 'NPC 档案');
  if (!Array.isArray(input.aliases) || input.aliases.length > 12) throw new Error('NPC 别名列表无效');
  const status = input.status;
  if (status !== 'active' && status !== 'missing' && status !== 'inactive' && status !== 'dead') throw new Error('NPC 状态无效');
  const groupPath = input.groupPath === undefined ? [] : input.groupPath;
  if (!Array.isArray(groupPath) || groupPath.length > 6) throw new Error('NPC 分组路径无效');
  return {
    id: text(input.id, 'NPC ID', 180),
    name: text(input.name, 'NPC 名称', 120),
    aliases: input.aliases.map(alias => text(alias, 'NPC 别名', 80)),
    role: looseText(input.role, 'NPC 身份', 120),
    location: looseText(input.location, 'NPC 地点', 120),
    status: status as NpcStatus,
    faction: looseText(input.faction, 'NPC 阵营', 120) || '未分类',
    groupPath: groupPath.map(part => text(part, 'NPC 分组', 80)),
    statReference: parseNpcStatReference(input.statReference),
    notesMarkdown: looseText(input.notesMarkdown, 'NPC 备注', 16_000),
    sourceFile: input.sourceFile === null || input.sourceFile === undefined ? null : text(input.sourceFile, 'NPC 来源文件', 180),
    updatedAt: numberIn(input.updatedAt, 'NPC 更新时间', 0, 10_000_000_000_000),
  };
}

function parseNpcStatReference(value: unknown): NpcRecord['statReference'] {
  if (value === undefined || value === null) return undefined;
  const input = record(value, 'NPC 数据来源');
  if (input.kind === 'custom') return { kind: 'custom' };
  if (input.kind === 'compendium') {
    return {
      kind: 'compendium', entryId: text(input.entryId, '资料 ID', 180),
      nameZh: text(input.nameZh, '资料中文名', 120), nameEn: text(input.nameEn, '资料英文名', 120),
    };
  }
  if (input.kind === 'npc') {
    return { kind: 'npc', npcId: text(input.npcId, 'NPC 数据 ID', 180), name: text(input.name, 'NPC 数据名称', 120) };
  }
  throw new Error('NPC 数据来源无效');
}

/** Parse an untrusted local backup before it is allowed to issue room ops. */
export function parseSceneBackup(source: string): SceneBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(source) as unknown;
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  const root = record(raw, '备份文件');
  if (root.format !== SCENE_BACKUP_FORMAT || root.version !== SCENE_BACKUP_VERSION) {
    throw new Error('不支持的备份文件版本');
  }

  const rawAssets = record(root.assets, '素材列表');
  const assetEntries = Object.entries(rawAssets);
  if (assetEntries.length > 200) throw new Error('备份中的素材数量过多');
  const assets: Record<string, BackupAsset> = {};
  for (const [id, value] of assetEntries) assets[text(id, '素材 ID', 120)] = parseAsset(value);

  const inputScene = record(root.scene, '场景');
  const inputGrid = record(inputScene.grid, '坐标吸附设置');
  const inputArea = record(inputScene.playArea, '可用区域');
  const rawTokens = inputScene.tokens;
  const rawWalls = inputScene.walls;
  const rawFavorites = inputScene.favorites;
  if (!Array.isArray(rawTokens) || rawTokens.length > 1_000) throw new Error('Token 列表无效');
  if (!Array.isArray(rawWalls) || rawWalls.length > 1_000) throw new Error('墙体列表无效');
  if (!Array.isArray(rawFavorites) || rawFavorites.length > 2_000) throw new Error('收藏列表无效');

  const walls = rawWalls.map(value => {
    const wall = record(value, '墙体');
    return {
      p1: pair(wall.p1, '墙体起点', -100_000, 100_000),
      p2: pair(wall.p2, '墙体终点', -100_000, 100_000),
    };
  });
  const favorites: Favorite[] = rawFavorites.map(value => {
    const favorite = record(value, '收藏');
    const type = favorite.type;
    if (type !== 'monster' && type !== 'spell' && type !== 'item' && type !== 'feat' && type !== 'condition') {
      throw new Error('收藏类型无效');
    }
    return { type, entryId: text(favorite.entryId, '收藏条目 ID', 180) };
  });
  let fog: boolean[] | undefined;
  if (inputScene.fog !== undefined) {
    if (!Array.isArray(inputScene.fog) || inputScene.fog.length > MAX_FOG_CELLS) throw new Error('迷雾数据无效');
    fog = inputScene.fog.map(value => bool(value, '迷雾单元'));
  }
  let fogReveals: FogRect[] | undefined;
  if (inputScene.fogReveals !== undefined) {
    if (!Array.isArray(inputScene.fogReveals) || inputScene.fogReveals.length > MAX_FOG_REVEAL_RECTS) {
      throw new Error('迷雾框选区域列表无效');
    }
    fogReveals = inputScene.fogReveals.map(value => {
      const rect = record(value, '迷雾框选区域');
      return {
        x: numberIn(rect.x, '迷雾框选 X 坐标', 0, 20_000),
        y: numberIn(rect.y, '迷雾框选 Y 坐标', 0, 20_000),
        w: numberIn(rect.w, '迷雾框选宽度', 1, 20_000),
        h: numberIn(rect.h, '迷雾框选高度', 1, 20_000),
      };
    });
  }

  let campaign: SceneBackup['campaign'];
  if (root.campaign !== undefined) {
    const inputCampaign = record(root.campaign, '战役');
    if (!Array.isArray(inputCampaign.enemies) || inputCampaign.enemies.length > 2_000) throw new Error('战役敌人列表无效');
    campaign = {
      name: text(inputCampaign.name, '战役名称', 120),
      enemies: inputCampaign.enemies.map(value => {
        const enemy = record(value, '战役敌人');
        return { entryId: text(enemy.entryId, '敌人条目 ID', 180), nameZh: text(enemy.nameZh, '敌人名称', 120) };
      }),
      ...(inputCampaign.npcs === undefined ? {} : {
        npcs: (() => {
          if (!Array.isArray(inputCampaign.npcs) || inputCampaign.npcs.length > 250) throw new Error('NPC 档案列表无效');
          return inputCampaign.npcs.map(parseNpc);
        })(),
      }),
    };
  }
  const totalRoomOps = rawTokens.length + rawWalls.length + rawFavorites.length + (campaign?.enemies.length ?? 0)
    + (campaign?.npcs?.length ?? 0) + (fogReveals?.length ?? 0) + 3;
  if (totalRoomOps > 3_000) throw new Error('备份包含过多实时操作，无法安全导入');

  const mapAssetId = assetId(inputScene.mapAssetId, assets, '地图素材');
  const mapSize = pair(inputScene.mapSize, '地图尺寸', 1, 20_000);
  const playArea = {
    x: numberIn(inputArea.x, '区域 X 坐标', -100_000, 100_000),
    y: numberIn(inputArea.y, '区域 Y 坐标', -100_000, 100_000),
    w: numberIn(inputArea.w, '区域宽度', 1, 20_000),
    h: numberIn(inputArea.h, '区域高度', 1, 20_000),
  };
  const fogWidth = mapAssetId ? mapSize[0] : playArea.w;
  const fogHeight = mapAssetId ? mapSize[1] : playArea.h;
  if (fogReveals?.some(rect => rect.x + rect.w > fogWidth + 0.001 || rect.y + rect.h > fogHeight + 0.001)) {
    throw new Error('迷雾框选区域超出地图范围');
  }
  return {
    format: SCENE_BACKUP_FORMAT,
    version: SCENE_BACKUP_VERSION,
    exportedAt: text(root.exportedAt, '导出时间', 80),
    scene: {
      name: text(inputScene.name, '场景名称', 120),
      mapSize,
      mapScale: numberIn(inputScene.mapScale, '地图缩放', 0.1, 8),
      ...(mapAssetId ? { mapAssetId } : {}),
      grid: {
        size: numberIn(inputGrid.size, '坐标吸附尺寸', 10, 500),
        offset: pair(inputGrid.offset, '坐标吸附偏移', -100_000, 100_000),
        snap: bool(inputGrid.snap, '坐标吸附开关'),
      },
      playArea,
      tokens: rawTokens.map(value => parseToken(value, assets)),
      walls,
      favorites,
      ...(fog ? { fog } : {}),
      ...(fogReveals ? { fogReveals } : {}),
      unlocked: bool(inputScene.unlocked, '场景公开状态'),
    },
    assets,
    ...(campaign ? { campaign } : {}),
  };
}

export function assetAsFile(asset: BackupAsset, fallbackName: string): File {
  let binary: string;
  try {
    binary = atob(asset.data);
  } catch {
    throw new Error('素材 Base64 数据损坏');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], fileName(asset.name || fallbackName, asset.type), { type: asset.type });
}

export function downloadSceneBackup(backup: SceneBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stem = backup.scene.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'scene';
  anchor.href = url;
  anchor.download = `${stem}-backup.dnd.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Construct the add-token payload expected by the existing room protocol.
 * The server deliberately replaces the temporary id with its own opaque id. */
export function importedToken(token: BackupToken, avatar: string, index: number): Token {
  return {
    id: `import-${index + 1}`,
    kind: token.kind === 'npc' ? 'npc' : 'monster',
    name: token.name,
    entryId: token.entryId,
    x: token.x,
    y: token.y,
    size: token.size,
    avatar,
    color: token.color,
    ...(token.hp ? { hp: { ...token.hp } } : {}),
  };
}
