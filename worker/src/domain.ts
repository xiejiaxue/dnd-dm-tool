import { resolveFogBasisScale, clipFogRectangle, revealFogRectangle, coverFogRectangles } from '../../shared/fog';
import { insertByValue, removeFromTurnOrder, stepTurn } from '../../shared/initiative';
import {
  type Campaign,
  type ChatMessage,
  type EntryType,
  type Favorite,
  FOG_CELL,
  fogGridSize,
  type GridConfig,
  type InitiativeEntry,
  type Op,
  type PlayArea,
  type PlayerToken,
  type Role,
  type Scene,
  type Token,
  type Wall,
} from '../../shared/types';

/** Roles are assigned by D1. They are never accepted from a browser payload. */
export type RoomRole = 'host' | 'dm' | 'assistant_dm' | 'player' | 'spectator';

export interface RoomActor {
  userId: string;
  memberId: string;
  role: RoomRole;
  accessEpoch: number;
  campaignId?: string;
  characterId?: string;
  characterName?: string;
  characterColor?: string;
  characterAvatar?: string;
  characterMaxHp?: number;
  displayName?: string;
}

export interface PersistedRoomState {
  schemaVersion: 2;
  revision: number;
  currentSceneId: string;
  campaign: Campaign;
  scenes: Record<string, Scene>;
  messages: ChatMessage[];
}

export interface RoomProjection {
  type: 'state';
  revision: number;
  role: Role;
  scene: Scene;
  campaign: Campaign;
  viewer: {
    userId: string;
    roomMemberId: string;
    roomRole: RoomRole;
    canManage: boolean;
  };
  messages: ChatMessage[];
}

const DEFAULT_GRID: GridConfig = {
  size: 100,
  color: '#00000040',
  offset: [0, 0],
  snap: false,
};
const DEFAULT_PLAY: PlayArea = { x: 0, y: 0, w: 1600, h: 1200 };

export function isRoomModerator(role: RoomRole): boolean {
  return role === 'host' || role === 'dm' || role === 'assistant_dm';
}

export function legacyRole(role: RoomRole): Role {
  // The existing board only has two display roles. Spectators deliberately use
  // the player projection and receive no writable capabilities.
  return isRoomModerator(role) ? 'dm' : 'player';
}

export function newOpaqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createScene(name: string): Scene {
  return {
    id: newOpaqueId('scene'),
    name: normalizeName(name, '未命名场景'),
    mapImage: null,
    mapSize: [1600, 1200],
    fogBasisScale: 1,
    mapScale: 1,
    grid: { ...DEFAULT_GRID, offset: [...DEFAULT_GRID.offset] as [number, number] },
    playArea: { ...DEFAULT_PLAY },
    tokens: [],
    players: [],
    walls: [],
    initiative: [],
    favorites: [],
    unlocked: true,
  };
}

export function createCampaign(name: string, firstSceneId: string, campaignId = newOpaqueId('campaign')): Campaign {
  return {
    id: campaignId,
    name: normalizeName(name, '未命名战役'),
    sceneIds: [firstSceneId],
    enemies: [],
  };
}

export function createInitialRoomState(roomName: string, campaignName: string, campaignId?: string, firstSceneName?: string): PersistedRoomState {
  const scene = createScene(firstSceneName || `${roomName} 场景`);
  const campaign = createCampaign(campaignName, scene.id, campaignId);
  return {
    schemaVersion: 2,
    revision: 0,
    currentSceneId: scene.id,
    campaign,
    scenes: { [scene.id]: scene },
    messages: [],
  };
}

export function projectRoomState(state: PersistedRoomState, actor: RoomActor): RoomProjection {
  const scene = state.scenes[state.currentSceneId];
  const campaign = state.campaign;
  if (!scene || !campaign) throw new Error('Room state has no active scene or campaign');

  const canManage = isRoomModerator(actor.role);
  const messages = (state.messages ?? []).filter((message) => message.campaignId === state.campaign.id && canSeeMessage(message, actor));
  if (canManage) {
    return {
      type: 'state',
      revision: state.revision,
      role: 'dm',
      scene: structuredClone(scene),
      campaign: structuredClone(campaign),
      viewer: { userId: actor.userId, roomMemberId: actor.memberId, roomRole: actor.role, canManage },
      messages: structuredClone(messages),
    };
  }

  // A player must never receive another player's stable account identifier.
  // Strip hidden encounter tokens and their initiative entries before transmission.
  const playerScene = structuredClone(scene);
  const hiddenIds = new Set(scene.tokens.filter(t => t.hidden).map(t => t.id));
  playerScene.tokens = playerScene.tokens.filter(t => !t.hidden);
  playerScene.initiative = playerScene.initiative.filter(e => !e.tokenId || !hiddenIds.has(e.tokenId));
  playerScene.players = playerScene.players.map((player) => ({
    ...player,
    sessionId: player.sessionId === actor.userId ? actor.userId : null,
  }));
  playerScene.initiative = playerScene.initiative.map((entry) => ({
    ...entry,
    sessionId: entry.sessionId === actor.userId ? actor.userId : null,
  }));

  return {
    type: 'state',
    revision: state.revision,
    role: 'player',
    scene: playerScene,
    // Encounter-library contents are DM-only. The campaign name and unlocked
    // scene ids are enough for the existing player board.
    campaign: { ...structuredClone(campaign), enemies: [] },
    viewer: { userId: actor.userId, roomMemberId: actor.memberId, roomRole: actor.role, canManage: false },
    messages: structuredClone(messages),
  };
}

/** Public messages reach everyone, 'gm' the author and moderators, 'self' only the author. */
export function canSeeMessage(message: ChatMessage, actor: RoomActor): boolean {
  if (message.visibility === 'public') return true;
  if (message.visibility === 'self') return message.userId === actor.userId;
  return isRoomModerator(actor.role) || message.userId === actor.userId;
}

export function ensurePlayerToken(state: PersistedRoomState, actor: RoomActor): boolean {
  if (actor.role !== 'player') return false;
  const scene = activeScene(state);
  if (scene.players.some((player) => player.sessionId === actor.userId)) return false;
  scene.players.push({
    id: actor.characterId ? `character-${actor.characterId}` : newOpaqueId('player'),
    kind: 'player',
    name: actor.characterName || '新玩家',
    entryId: null,
    x: 200 + scene.players.length * 60,
    y: 200,
    size: 48,
    avatar: actor.characterAvatar || '',
    color: actor.characterColor || '#38a169',
    sessionId: actor.userId,
    ...(actor.characterMaxHp ? { hp: { current: actor.characterMaxHp, max: actor.characterMaxHp } } : {}),
  });
  return true;
}

/**
 * Parse an untrusted legacy board operation and turn it into a server-owned
 * mutation. This compatibility layer keeps the current Konva UI working while
 * identity and permission decisions stay in the Durable Object.
 */
export function authorizeOperation(value: unknown, state: PersistedRoomState, actor: RoomActor): Op {
  if (!isRecord(value) || typeof value.op !== 'string') throw new DomainError('INVALID', '操作格式无效');
  const op = value.op;
  const dm = isRoomModerator(actor.role);

  if (!dm) return authorizePlayerOperation(value, state, actor);

  switch (op) {
    case 'moveToken':
      return { op, tokenId: id(value.tokenId), x: coordinate(value.x), y: coordinate(value.y) };
    case 'addToken':
      return { op, token: token(value.token, 'monster') };
    case 'removeToken':
      return { op, tokenId: id(value.tokenId) };
    case 'updateToken':
      return { op, tokenId: id(value.tokenId), patch: tokenPatch(value.patch) };
    case 'addPlayer':
      return { op, player: playerToken(value.player, null) };
    case 'removePlayer':
      return { op, tokenId: id(value.tokenId) };
    case 'updatePlayer':
      return { op, tokenId: id(value.tokenId), patch: playerPatch(value.patch, true) };
    case 'addWall':
      return { op, wall: wall(value.wall) };
    case 'removeWall':
      return { op, wallId: id(value.wallId) };
    case 'updateGrid':
      return { op, patch: gridPatch(value.patch) };
    case 'updateMap':
      return { op, mapImage: mapUrl(value.mapImage), mapSize: sizePair(value.mapSize), playArea: playArea(value.playArea), fogBasisScale: value.fogBasisScale === undefined ? 1 : boundedNumber(value.fogBasisScale, 0.1, 8) };
    case 'updateMapScale':
      return { op, mapScale: boundedNumber(value.mapScale, 0.1, 8) };
    case 'addEnemy':
      return { op, entryId: shortText(value.entryId, 180), nameZh: shortText(value.nameZh, 120) };
    case 'removeEnemy':
      return { op, entryId: shortText(value.entryId, 180) };
    case 'submitInitiative':
      return {
        op,
        name: shortText(value.name, 120),
        value: boundedNumber(value.value, -100, 100),
        tokenId: nullableId(value.tokenId),
        sessionId: null,
      };
    case 'addToInitiative':
      return { op, name: shortText(value.name, 120), value: boundedNumber(value.value, -100, 100), source: 'dm', tokenId: nullableId(value.tokenId) };
    case 'removeFromInitiative':
      return { op, entryId: id(value.entryId) };
    case 'advanceTurn':
    case 'previousTurn':
      return { op };
    case 'reorderInitiative':
      return { op, order: idList(value.order, 250) };
    case 'addFavorite':
      return { op, favorite: favorite(value.favorite) };
    case 'removeFavorite':
      return { op, type: entryType(value.type), entryId: shortText(value.entryId, 180) };
    case 'revealFogRect': {
      if (!isRecord(value.rect)) throw new DomainError('INVALID', '迷雾选区无效');
      const rect = clipFogRectangle(activeScene(state), {
        x: boundedNumber(value.rect.x, -100_000, 100_000), y: boundedNumber(value.rect.y, -100_000, 100_000),
        width: boundedNumber(value.rect.width, Number.MIN_VALUE, 100_000), height: boundedNumber(value.rect.height, Number.MIN_VALUE, 100_000),
      });
      if (!rect) throw new DomainError('INVALID', '迷雾选区不在地图内');
      return { op, rect };
    }
    case 'setFog': {
      const scene = activeScene(state), basisScale = resolveFogBasisScale(scene);
      const incoming = value.basisScale === undefined ? (scene.mapImage ? scene.mapScale ?? 1 : 1) : boundedNumber(value.basisScale, 0.1, 8);
      if (Math.abs(incoming - basisScale) > 0.000001) throw new DomainError('INVALID', '迷雾坐标已更新，请刷新页面后重试');
      return { op, cells: integerList(value.cells, 2_000, 0, 2_000_000), revealed: value.revealed === true, basisScale };
    }
    case 'revealAllFog':
    case 'coverAllFog':
      return { op };
    // A room cannot switch to an arbitrary D1 campaign from a browser. This
    // compatibility command only permits a campaign that already belongs to
    // this room's persisted state.
    case 'switchCampaign': { throw new DomainError('INVALID', '请从大厅进入其他战役'); }
    default:
      throw new DomainError('INVALID', '未知操作');
  }
}

function authorizePlayerOperation(value: Record<string, unknown>, state: PersistedRoomState, actor: RoomActor): Op {
  const scene = activeScene(state);
  const own = scene.players.find((player) => player.sessionId === actor.userId);
  switch (value.op) {
    case 'moveToken': {
      const tokenId = id(value.tokenId);
      if (!own || own.id !== tokenId) throw new DomainError('FORBIDDEN', '只能移动自己的角色');
      return { op: 'moveToken', tokenId, x: coordinate(value.x), y: coordinate(value.y) };
    }
    case 'updatePlayer': {
      const tokenId = id(value.tokenId);
      if (!own || own.id !== tokenId) throw new DomainError('FORBIDDEN', '只能编辑自己的角色');
      return { op: 'updatePlayer', tokenId, patch: playerPatch(value.patch, false) };
    }
    case 'submitInitiative': {
      if (!own) throw new DomainError('FORBIDDEN', '尚未认领角色');
      return {
        op: 'submitInitiative',
        name: own.name,
        value: boundedNumber(value.value, -100, 100),
        tokenId: own.id,
        sessionId: actor.userId,
      };
    }
    default:
      throw new DomainError('FORBIDDEN', '当前身份不能执行此操作');
  }
}

export function applyOperation(state: PersistedRoomState, op: Op): void {
  const scene = activeScene(state);
  switch (op.op) {
    case 'addToken': {
      if (!scene.tokens.some((item) => item.id === op.token.id)) {
        const next = { ...op.token };
        if (next.kind === 'monster' && next.entryId) {
          const same = scene.tokens.filter((item) => item.kind === 'monster' && item.entryId === next.entryId);
          next.number = Math.max(0, ...same.map((item) => item.number ?? 0)) + 1;
        }
        scene.tokens.push(next);
      }
      return;
    }
    case 'moveToken': {
      const target = findToken(scene, op.tokenId);
      if (target) { target.x = op.x; target.y = op.y; }
      return;
    }
    case 'removeToken':
      Object.assign(scene, removeFromTurnOrder(scene, (item) => item.tokenId === op.tokenId));
      scene.tokens = scene.tokens.filter((item) => item.id !== op.tokenId);
      return;
    case 'updateToken': {
      const target = scene.tokens.find((item) => item.id === op.tokenId);
      if (target) Object.assign(target, op.patch);
      return;
    }
    case 'addPlayer':
      if (!scene.players.some((item) => item.id === op.player.id)) scene.players.push(op.player);
      return;
    case 'removePlayer':
      scene.players = scene.players.filter((item) => item.id !== op.tokenId);
      Object.assign(scene, removeFromTurnOrder(scene, (item) => item.tokenId === op.tokenId));
      return;
    case 'updatePlayer': {
      const target = scene.players.find((item) => item.id === op.tokenId);
      if (target) Object.assign(target, op.patch);
      return;
    }
    case 'addWall':
      if (!scene.walls.some((item) => item.id === op.wall.id)) scene.walls.push(op.wall);
      return;
    case 'removeWall':
      scene.walls = scene.walls.filter((item) => item.id !== op.wallId);
      return;
    case 'updateGrid':
      Object.assign(scene.grid, op.patch);
      return;
    case 'updateMap':
      scene.mapImage = op.mapImage;
      scene.mapSize = op.mapSize;
      scene.playArea = op.playArea;
      scene.mapScale = 1;
      scene.fogBasisScale = op.fogBasisScale ?? 1;
      scene.fog = undefined;
      scene.fogReveals = undefined;
      return;
    case 'updateMapScale':
      scene.fogBasisScale = resolveFogBasisScale(scene);
      scene.mapScale = op.mapScale;
      return;
    case 'addEnemy': {
      const campaign = activeCampaign(state);
      if (!campaign.enemies.some((entry) => entry.entryId === op.entryId)) {
        campaign.enemies.push({ entryId: op.entryId, nameZh: op.nameZh });
      }
      return;
    }
    case 'removeEnemy':
      activeCampaign(state).enemies = activeCampaign(state).enemies.filter((entry) => entry.entryId !== op.entryId);
      return;
    case 'switchCampaign': { throw new DomainError('INVALID', '请从大厅进入其他战役'); }
    case 'submitInitiative': {
      const existing = op.sessionId
        ? scene.initiative.find((entry) => entry.sessionId === op.sessionId)
        : scene.initiative.find((entry) => entry.source === 'player' && entry.name === op.name);
      // A changed value moves the entry to its new place; other entries keep
      // any manual tie-break order the DM set.
      const others = existing ? scene.initiative.filter((entry) => entry !== existing) : scene.initiative;
      scene.initiative = insertByValue(others, existing
        ? { ...existing, name: op.name, value: op.value, tokenId: op.tokenId ?? existing.tokenId }
        : {
            id: newOpaqueId('initiative'),
            name: op.name,
            value: op.value,
            source: 'player',
            sessionId: op.sessionId ?? null,
            tokenId: op.tokenId,
            active: false,
          });
      return;
    }
    case 'addToInitiative':
      scene.initiative = insertByValue(scene.initiative, {
        id: newOpaqueId('initiative'),
        name: op.name,
        value: op.value,
        source: 'dm',
        sessionId: null,
        tokenId: op.tokenId,
        active: false,
      });
      return;
    case 'removeFromInitiative':
      Object.assign(scene, removeFromTurnOrder(scene, (entry) => entry.id === op.entryId));
      return;
    case 'advanceTurn':
    case 'previousTurn':
      Object.assign(scene, stepTurn(scene, op.op === 'advanceTurn' ? 1 : -1));
      return;
    case 'reorderInitiative': {
      const byId = new Map(scene.initiative.map((entry) => [entry.id, entry]));
      const ordered: InitiativeEntry[] = [];
      for (const entryId of op.order) {
        const entry = byId.get(entryId);
        if (entry) { ordered.push(entry); byId.delete(entryId); }
      }
      scene.initiative = [...ordered, ...byId.values()];
      return;
    }
    case 'addFavorite':
      if (!scene.favorites.some((item) => item.type === op.favorite.type && item.entryId === op.favorite.entryId)) {
        scene.favorites.push(op.favorite);
      }
      return;
    case 'removeFavorite':
      scene.favorites = scene.favorites.filter((item) => item.type !== op.type || item.entryId !== op.entryId);
      return;
    case 'revealFogRect':
      scene.fogReveals = revealFogRectangle(scene, op.rect);
      return;
    case 'setFog': {
      if (!op.revealed) scene.fogReveals = coverFogRectangles(scene, op.cells);
      const fog = ensureFog(scene);
      for (const cell of op.cells) if (cell >= 0 && cell < fog.length) fog[cell] = op.revealed;
      return;
    }
    case 'revealAllFog':
      ensureFog(scene).fill(true);
      scene.fogReveals = undefined;
      return;
    case 'coverAllFog':
      ensureFog(scene).fill(false);
      scene.fogReveals = undefined;
      return;
    default: {
      // A new Op variant without a case above fails to compile here instead of being silently ignored.
      const unhandled: never = op;
      throw new DomainError('INVALID', `未处理的操作：${(unhandled as { op: string }).op}`);
    }
  }
}

export function activeScene(state: PersistedRoomState): Scene {
  const scene = state.scenes[state.currentSceneId];
  if (!scene) throw new DomainError('CORRUPT_STATE', '找不到当前场景');
  return scene;
}

export function activeCampaign(state: PersistedRoomState): Campaign {
  const campaign = state.campaign;
  if (!campaign) throw new DomainError('CORRUPT_STATE', '找不到当前战役');
  return campaign;
}

export function addScene(state: PersistedRoomState, name: string): Scene {
  const scene = createScene(name);
  state.scenes[scene.id] = scene;
  activeCampaign(state).sceneIds.push(scene.id);
  return scene;
}

export function deleteScene(state: PersistedRoomState, sceneId: string): boolean {
  const campaign = activeCampaign(state);
  if (!campaign.sceneIds.includes(sceneId) || campaign.sceneIds.length <= 1) return false;
  campaign.sceneIds = campaign.sceneIds.filter((id) => id !== sceneId);
  delete state.scenes[sceneId];
  if (state.currentSceneId === sceneId) state.currentSceneId = campaign.sceneIds[0];
  return true;
}

export function renameScene(state: PersistedRoomState, sceneId: string, name: string): void {
  const scene = state.scenes[sceneId];
  if (!scene || !activeCampaign(state).sceneIds.includes(sceneId)) throw new DomainError('NOT_FOUND', '找不到场景');
  scene.name = normalizeName(name, scene.name);
}

export function selectScene(state: PersistedRoomState, sceneId: string): void {
  if (!activeCampaign(state).sceneIds.includes(sceneId) || !state.scenes[sceneId]) {
    throw new DomainError('NOT_FOUND', '找不到场景');
  }
  state.currentSceneId = sceneId;
}

export function setSceneUnlocked(state: PersistedRoomState, sceneId: string, unlocked: boolean): void {
  const scene = state.scenes[sceneId];
  if (!scene || !activeCampaign(state).sceneIds.includes(sceneId)) throw new DomainError('NOT_FOUND', '找不到场景');
  scene.unlocked = unlocked;
}

export class DomainError extends Error {
  constructor(public readonly code: 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' | 'CORRUPT_STATE', message: string) {
    super(message);
  }
}

function ensureFog(scene: Scene): boolean[] {
  scene.fogBasisScale = resolveFogBasisScale(scene);
  const { cols, rows } = fogGridSize(scene);
  const length = cols * rows;
  if (!scene.fog || scene.fog.length !== length) scene.fog = new Array(length).fill(false);
  return scene.fog;
}

function findToken(scene: Scene, tokenId: string): Token | PlayerToken | undefined {
  return scene.tokens.find((token) => token.id === tokenId) ?? scene.players.find((token) => token.id === tokenId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function id(value: unknown): string {
  return shortText(value, 180);
}

function nullableId(value: unknown): string | null {
  return value === null ? null : id(value);
}

function shortText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') throw new DomainError('INVALID', '需要文本字段');
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) throw new DomainError('INVALID', '文本长度无效');
  return normalized;
}

function normalizeName(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 120);
  return normalized || fallback;
}

function boundedNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new DomainError('INVALID', '数值超出允许范围');
  }
  return value;
}

function coordinate(value: unknown): number {
  return boundedNumber(value, -100_000, 100_000);
}

function integerList(value: unknown, maxItems: number, min: number, max: number): number[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new DomainError('INVALID', '数组长度无效');
  return [...new Set(value.map((item) => {
    if (!Number.isInteger(item) || typeof item !== 'number' || item < min || item > max) {
      throw new DomainError('INVALID', '数组元素无效');
    }
    return item;
  }))];
}

function idList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new DomainError('INVALID', '数组长度无效');
  return [...new Set(value.map((item) => id(item)))];
}

function sizePair(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new DomainError('INVALID', '尺寸无效');
  return [boundedNumber(value[0], 1, 20_000), boundedNumber(value[1], 1, 20_000)];
}

function point(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new DomainError('INVALID', '坐标无效');
  return [coordinate(value[0]), coordinate(value[1])];
}

function playArea(value: unknown): PlayArea {
  if (!isRecord(value)) throw new DomainError('INVALID', '区域无效');
  return {
    x: coordinate(value.x),
    y: coordinate(value.y),
    w: boundedNumber(value.w, 1, 20_000),
    h: boundedNumber(value.h, 1, 20_000),
  };
}

function mapUrl(value: unknown): string | null {
  if (value === null) return null;
  const url = shortText(value, 500);
  // Room assets are always served through an authenticated same-origin route.
  if (!url.startsWith('/api/campaigns/')) throw new DomainError('INVALID', '地图必须引用战役的私有素材');
  return url;
}

function token(value: unknown, requiredKind: 'monster' | 'player'): Token {
  if (!isRecord(value)) throw new DomainError('INVALID', 'Token 无效');
  const entry = value.entryId === null ? null : shortText(value.entryId, 180);
  return {
    id: newOpaqueId('token'),
    kind: requiredKind,
    name: shortText(value.name, 120),
    entryId: entry,
    x: coordinate(value.x),
    y: coordinate(value.y),
    size: boundedNumber(value.size, 12, 500),
    avatar: optionalAssetUrl(value.avatar),
    color: color(value.color),
    hp: hp(value.hp),
    ...(requiredKind === 'monster' ? { hidden: value.hidden === undefined ? true : tokenHidden(value.hidden) } : {}),
    ...(value.initiativeBonus === undefined ? {} : { initiativeBonus: initiativeBonus(value.initiativeBonus) }),
  };
}

function playerToken(value: unknown, sessionId: string | null): PlayerToken {
  const base = token(value, 'player');
  return { ...base, sessionId };
}

function wall(value: unknown): Wall {
  if (!isRecord(value)) throw new DomainError('INVALID', '墙体无效');
  return { id: newOpaqueId('wall'), p1: point(value.p1), p2: point(value.p2) };
}

function initiativeBonus(value: unknown): number {
  const bonus = boundedNumber(value, -50, 50);
  if (!Number.isInteger(bonus)) throw new DomainError('INVALID', '先攻加值必须是整数');
  return bonus;
}

function tokenHidden(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new DomainError('INVALID', '隐藏状态必须是布尔值');
  return value;
}

function tokenPatch(value: unknown): Partial<Pick<Token, 'name' | 'size' | 'avatar' | 'color' | 'hp' | 'initiativeBonus' | 'hidden'>> {
  if (!isRecord(value)) throw new DomainError('INVALID', '更新无效');
  const patch: Partial<Pick<Token, 'name' | 'size' | 'avatar' | 'color' | 'hp' | 'initiativeBonus' | 'hidden'>> = {};
  if (value.name !== undefined) patch.name = shortText(value.name, 120);
  if (value.hidden !== undefined) patch.hidden = tokenHidden(value.hidden);
  if (value.size !== undefined) patch.size = boundedNumber(value.size, 12, 500);
  if (value.avatar !== undefined) patch.avatar = optionalAssetUrl(value.avatar);
  if (value.color !== undefined) patch.color = color(value.color);
  if (value.hp !== undefined) patch.hp = hp(value.hp);
  if (value.initiativeBonus !== undefined) patch.initiativeBonus = initiativeBonus(value.initiativeBonus);
  if (Object.keys(patch).length === 0) throw new DomainError('INVALID', '没有可更新字段');
  return patch;
}

function playerPatch(value: unknown, maySetHp: boolean): Partial<Pick<PlayerToken, 'name' | 'color' | 'sessionId' | 'hp' | 'avatar' | 'initiativeBonus'>> {
  if (!isRecord(value)) throw new DomainError('INVALID', '更新无效');
  const patch: Partial<Pick<PlayerToken, 'name' | 'color' | 'sessionId' | 'hp' | 'avatar' | 'initiativeBonus'>> = {};
  if (value.name !== undefined) patch.name = shortText(value.name, 120);
  if (value.color !== undefined) patch.color = color(value.color);
  if (value.avatar !== undefined) patch.avatar = optionalAssetUrl(value.avatar);
  if (maySetHp && value.hp !== undefined) patch.hp = hp(value.hp);
  if (maySetHp && value.initiativeBonus !== undefined) patch.initiativeBonus = initiativeBonus(value.initiativeBonus);
  if (Object.keys(patch).length === 0) throw new DomainError('INVALID', '没有可更新字段');
  return patch;
}

function gridPatch(value: unknown): Partial<GridConfig> {
  if (!isRecord(value)) throw new DomainError('INVALID', '网格设置无效');
  const patch: Partial<GridConfig> = {};
  if (value.size !== undefined) patch.size = boundedNumber(value.size, 10, 500);
  if (value.color !== undefined) patch.color = color(value.color);
  if (value.offset !== undefined) patch.offset = point(value.offset);
  if (value.snap !== undefined) {
    if (typeof value.snap !== 'boolean') throw new DomainError('INVALID', '网格设置无效');
    patch.snap = value.snap;
  }
  if (Object.keys(patch).length === 0) throw new DomainError('INVALID', '没有可更新字段');
  return patch;
}

function optionalAssetUrl(value: unknown): string {
  if (typeof value !== 'string') throw new DomainError('INVALID', '素材地址无效');
  if (value === '') return '';
  const url = shortText(value, 500);
  if (/^\/api\/token\/[^/?#\\]+$/u.test(url)) return url;
  return mapUrl(url) ?? '';
}

function color(value: unknown): string {
  const candidate = shortText(value, 32);
  if (!/^#[0-9a-fA-F]{3,8}$|^rgba?\([0-9.,\s%]+\)$/.test(candidate)) {
    throw new DomainError('INVALID', '颜色格式无效');
  }
  return candidate;
}

function hp(value: unknown): { current: number; max: number } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new DomainError('INVALID', '生命值无效');
  return { current: boundedNumber(value.current, -10_000, 100_000), max: boundedNumber(value.max, 1, 100_000) };
}

function entryType(value: unknown): EntryType {
  if (value === 'monster' || value === 'spell' || value === 'item' || value === 'feat' || value === 'condition') return value;
  throw new DomainError('INVALID', '条目类型无效');
}

function favorite(value: unknown): Favorite {
  if (!isRecord(value)) throw new DomainError('INVALID', '收藏无效');
  return { type: entryType(value.type), entryId: shortText(value.entryId, 180) };
}

// Keep the value referenced so Tree Shaking cannot accidentally erase the
// fog-cell contract from the worker bundle while the client still imports it.
void FOG_CELL;
