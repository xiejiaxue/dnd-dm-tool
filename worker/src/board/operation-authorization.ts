import {
  FOG_CELL,
  type EntryType,
  type Favorite,
  type FogRect,
  type GridConfig,
  type NpcImportance,
  type NpcPlayerAccess,
  type NpcRecord,
  type NpcStatus,
  type Op,
  type PlayArea,
  type PlayerToken,
  type PlayerUpdatePatch,
  type Token,
  type TokenUpdatePatch,
  type TokenCondition,
  type TokenConditionId,
  type Wall,
} from '../../../shared/types';
import { fogExtent, fogRectContains, MAX_FOG_REVEAL_RECTS } from '../../../shared/fog-rects';
import { canonicalizeNpcRecord } from '../../../shared/npc-metadata';
import {
  activeScene,
  currentEncounter,
  DomainError,
  isRoomModerator,
  type PersistedRoomState,
  type RoomActor,
} from '../domain';

/**
 * Parse an untrusted browser operation into a server-owned mutation. Keeping
 * this boundary outside the state reducer makes authorization independently
 * auditable and prevents transport payloads from leaking into domain code.
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
      return { op, token: boardToken(value.token) };
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
    case 'updateWall':
      return { op, wallId: id(value.wallId), patch: wallPatch(value.patch) };
    case 'updateGrid':
      return { op, patch: gridPatch(value.patch) };
    case 'updateMap':
      return { op, mapImage: mapUrl(value.mapImage), mapSize: sizePair(value.mapSize), playArea: playArea(value.playArea) };
    case 'updateMapScale':
      return { op, mapScale: boundedNumber(value.mapScale, 0.1, 8) };
    case 'addEnemy':
      return { op, entryId: shortText(value.entryId, 180), nameZh: shortText(value.nameZh, 120) };
    case 'removeEnemy':
      return { op, entryId: shortText(value.entryId, 180) };
    case 'upsertNpc':
      return { op, npc: npcRecord(value.npc, state) };
    case 'removeNpc':
      return { op, npcId: id(value.npcId) };
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
    case 'setCombatantHidden':
      return { op, entryId: id(value.entryId), hidden: boolean(value.hidden, '先攻可见性') };
    case 'updateCombatant':
      return { op, entryId: id(value.entryId), patch: combatantPatch(value.patch) };
    case 'createEncounter':
    case 'duplicateEncounter':
    case 'startEncounter':
    case 'endEncounter':
    case 'previousTurn':
    case 'nextTurn':
    case 'previousRound':
    case 'nextRound':
    case 'advanceTurn':
      return { op };
    case 'endMyTurn':
      throw new DomainError('FORBIDDEN', '主持人请使用下一行动');
    case 'reorderInitiative':
      return { op, order: idList(value.order, 250) };
    case 'addFavorite':
      return { op, favorite: favorite(value.favorite) };
    case 'removeFavorite':
      return { op, type: entryType(value.type), entryId: shortText(value.entryId, 180) };
    case 'setFog':
      return { op, cells: integerList(value.cells, 2_000, 0, 2_000_000), revealed: value.revealed === true };
    case 'revealFogRect':
      return { op, rect: fogRect(value.rect, state) };
    case 'revealAllFog':
    case 'coverAllFog':
      return { op };
    case 'restoreFog':
      return fogSnapshot(value, state);
    case 'switchCampaign': {
      const campaignId = id(value.campaignId);
      if (!state.campaigns[campaignId]) throw new DomainError('INVALID', '战役不属于当前房间');
      return { op, campaignId };
    }
    default:
      throw new DomainError('INVALID', '未知操作');
  }
}

function authorizePlayerOperation(value: Record<string, unknown>, state: PersistedRoomState, actor: RoomActor): Op {
  const own = activeScene(state).players.find((player) => player.sessionId === actor.userId);
  switch (value.op) {
    case 'moveToken': {
      const tokenId = id(value.tokenId);
      if (!own || own.id !== tokenId) throw new DomainError('FORBIDDEN', '只能移动自己的角色');
      return { op: 'moveToken', tokenId, x: coordinate(value.x), y: coordinate(value.y) };
    }
    case 'updatePlayer': {
      const tokenId = id(value.tokenId);
      if (!own || own.id !== tokenId) throw new DomainError('FORBIDDEN', '只能编辑自己的角色');
      return { op: 'updatePlayer', tokenId, patch: playerPatch(value.patch, true) };
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
    case 'endMyTurn': {
      const encounter = currentEncounter(state);
      const active = encounter?.status === 'active' && encounter.turn !== null
        ? encounter.combatants[encounter.turn]
        : undefined;
      if (!active || active.sessionId !== actor.userId) throw new DomainError('FORBIDDEN', '现在不是你的行动');
      return { op: 'endMyTurn' };
    }
    default:
      throw new DomainError('FORBIDDEN', '当前身份不能执行此操作');
  }
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

function fogRect(value: unknown, state: PersistedRoomState): { x: number; y: number; w: number; h: number } {
  if (!isRecord(value)) throw new DomainError('INVALID', '迷雾框选区域无效');
  const scene = activeScene(state);
  const { width, height } = fogExtent(scene);
  const rect = {
    x: boundedNumber(value.x, 0, width),
    y: boundedNumber(value.y, 0, height),
    w: boundedNumber(value.w, 1, width),
    h: boundedNumber(value.h, 1, height),
  };
  if (rect.x + rect.w > width + 0.001 || rect.y + rect.h > height + 0.001) {
    throw new DomainError('INVALID', '迷雾框选区域超出地图范围');
  }
  const existing = scene.fogReveals ?? [];
  if (existing.length >= MAX_FOG_REVEAL_RECTS && !existing.some(candidate => fogRectContains(candidate, rect))) {
    throw new DomainError('INVALID', '迷雾框选区域数量过多，请先重置遮罩');
  }
  return rect;
}

function mapUrl(value: unknown): string | null {
  if (value === null) return null;
  const url = shortText(value, 500);
  if (!url.startsWith('/api/rooms/')) throw new DomainError('INVALID', '地图必须引用当前房间的私有素材');
  return url;
}

function token(value: unknown, requiredKind: 'monster' | 'npc' | 'player'): Token {
  if (!isRecord(value)) throw new DomainError('INVALID', 'Token 无效');
  const entry = value.entryId === null ? null : shortText(value.entryId, 180);
  return {
    id: id(value.id),
    kind: requiredKind,
    actorId: value.actorId === undefined || value.actorId === null || value.actorId === '' ? null : id(value.actorId),
    name: shortText(value.name, 120),
    entryId: entry,
    x: coordinate(value.x),
    y: coordinate(value.y),
    size: boundedNumber(value.size, 12, 500),
    avatar: optionalAssetUrl(value.avatar),
    color: color(value.color),
    hp: hp(value.hp),
    hidden: optionalBoolean(value.hidden, false),
    publicName: optionalText(value.publicName, 120),
    hpVisibility: tokenHpVisibility(value.hpVisibility),
    conditions: tokenConditions(value.conditions),
  };
}

function boardToken(value: unknown): Token {
  if (!isRecord(value) || (value.kind !== 'monster' && value.kind !== 'npc')) {
    throw new DomainError('INVALID', 'Token 类型无效');
  }
  return token(value, value.kind);
}

function npcRecord(value: unknown, state: PersistedRoomState): NpcRecord {
  if (!isRecord(value)) throw new DomainError('INVALID', 'NPC 档案无效');
  const npcId = id(value.id);
  const campaign = state.campaigns[state.currentCampaignId];
  const exists = (campaign?.npcs ?? []).some((npc) => npc.id === npcId);
  if (!exists && (campaign?.npcs?.length ?? 0) >= 250) {
    throw new DomainError('INVALID', 'NPC 档案数量已达到上限');
  }
  return canonicalizeNpcRecord({
    id: npcId,
    name: shortText(value.name, 120),
    aliases: shortTextList(value.aliases, 12, 80),
    role: optionalText(value.role, 120),
    location: optionalText(value.location, 120),
    status: npcStatus(value.status),
    importance: npcImportance(value.importance),
    faction: optionalText(value.faction, 120) || '未分类',
    groupPath: npcGroupPath(value.groupPath),
    statReference: npcStatReference(value.statReference),
    notesMarkdown: optionalText(value.notesMarkdown, 16_000),
    playerAccess: npcPlayerAccess(value.playerAccess),
    publicDescription: optionalText(value.publicDescription, 4_000),
    sourceFile: value.sourceFile === null ? null : optionalNullableText(value.sourceFile, 180),
    updatedAt: Date.now(),
  });
}

function npcGroupPath(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return shortTextList(value, 6, 80);
}

function npcStatReference(value: unknown): NpcRecord['statReference'] {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new DomainError('INVALID', 'NPC 数据来源无效');
  if (value.kind === 'custom') return { kind: 'custom' };
  if (value.kind === 'compendium') {
    return {
      kind: 'compendium',
      entryId: shortText(value.entryId, 180),
      nameZh: shortText(value.nameZh, 120),
      nameEn: shortText(value.nameEn, 120),
    };
  }
  if (value.kind === 'npc') {
    return { kind: 'npc', npcId: shortText(value.npcId, 180), name: shortText(value.name, 120) };
  }
  throw new DomainError('INVALID', 'NPC 数据来源无效');
}

function shortTextList(value: unknown, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new DomainError('INVALID', 'NPC 别名列表无效');
  return [...new Set(value.map((item) => shortText(item, maximumLength)))];
}

function optionalText(value: unknown, maximumLength: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new DomainError('INVALID', 'NPC 文本字段无效');
  const normalized = value.trim();
  if (normalized.length > maximumLength) throw new DomainError('INVALID', 'NPC 文本字段过长');
  return normalized;
}

function optionalNullableText(value: unknown, maximumLength: number): string | null {
  const normalized = optionalText(value, maximumLength);
  return normalized || null;
}

function npcStatus(value: unknown): NpcStatus {
  if (value === 'active' || value === 'missing' || value === 'inactive' || value === 'dead') return value;
  throw new DomainError('INVALID', 'NPC 状态无效');
}

function npcImportance(value: unknown): NpcImportance | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'major' || value === 'supporting' || value === 'minor') return value;
  throw new DomainError('INVALID', 'NPC 重要程度无效');
}

function npcPlayerAccess(value: unknown): NpcPlayerAccess {
  if (value === undefined || value === null || value === '') return 'none';
  if (value === 'none' || value === 'limited' || value === 'observer') return value;
  throw new DomainError('INVALID', 'NPC 玩家权限无效');
}

function playerToken(value: unknown, sessionId: string | null): PlayerToken {
  return { ...token(value, 'player'), sessionId };
}

function wall(value: unknown): Wall {
  if (!isRecord(value)) throw new DomainError('INVALID', '墙体无效');
  return { id: id(value.id), p1: point(value.p1), p2: point(value.p2) };
}

function wallPatch(value: unknown): Partial<Pick<Wall, 'p1' | 'p2'>> {
  if (!isRecord(value)) throw new DomainError('INVALID', '墙体更新无效');
  const patch: Partial<Pick<Wall, 'p1' | 'p2'>> = {};
  if (value.p1 !== undefined) patch.p1 = point(value.p1);
  if (value.p2 !== undefined) patch.p2 = point(value.p2);
  if (Object.keys(patch).length === 0) throw new DomainError('INVALID', '没有可更新字段');
  return patch;
}

function fogSnapshot(value: Record<string, unknown>, state: PersistedRoomState): Op {
  const scene = activeScene(state);
  const fog = value.fog === null ? null : value.fog;
  if (fog !== null && (!Array.isArray(fog) || fog.length > 100_000 || fog.some((cell) => typeof cell !== 'boolean'))) {
    throw new DomainError('INVALID', '迷雾快照无效');
  }
  if (!Array.isArray(value.fogReveals) || value.fogReveals.length > MAX_FOG_REVEAL_RECTS) {
    throw new DomainError('INVALID', '迷雾快照无效');
  }
  const { width, height } = fogExtent(scene);
  const fogReveals = value.fogReveals.map((candidate): FogRect => {
    if (!isRecord(candidate)) throw new DomainError('INVALID', '迷雾快照无效');
    const rect = {
      x: boundedNumber(candidate.x, 0, width),
      y: boundedNumber(candidate.y, 0, height),
      w: boundedNumber(candidate.w, 1, width),
      h: boundedNumber(candidate.h, 1, height),
    };
    if (rect.x + rect.w > width + 0.001 || rect.y + rect.h > height + 0.001) {
      throw new DomainError('INVALID', '迷雾快照超出地图范围');
    }
    return rect;
  });
  return { op: 'restoreFog', fog: fog ? [...fog] : null, fogReveals };
}

function tokenPatch(value: unknown): TokenUpdatePatch {
  if (!isRecord(value)) throw new DomainError('INVALID', '更新无效');
  const patch: TokenUpdatePatch = {};
  if (value.name !== undefined) patch.name = shortText(value.name, 120);
  if (value.size !== undefined) patch.size = boundedNumber(value.size, 12, 500);
  if (value.avatar !== undefined) patch.avatar = optionalAssetUrl(value.avatar);
  if (value.color !== undefined) patch.color = color(value.color);
  if (value.hp !== undefined) patch.hp = value.hp === null ? null : hp(value.hp);
  if (value.hidden !== undefined) patch.hidden = boolean(value.hidden, 'Token 可见性');
  if (value.publicName !== undefined) patch.publicName = optionalText(value.publicName, 120);
  if (value.hpVisibility !== undefined) patch.hpVisibility = tokenHpVisibility(value.hpVisibility);
  if (value.conditions !== undefined) patch.conditions = tokenConditions(value.conditions);
  if (Object.keys(patch).length === 0) throw new DomainError('INVALID', '没有可更新字段');
  return patch;
}

function tokenHpVisibility(value: unknown): Token['hpVisibility'] {
  if (value === undefined || value === null || value === '') return 'value';
  if (value === 'none' || value === 'bar' || value === 'value') return value;
  throw new DomainError('INVALID', 'HP 可见性无效');
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new DomainError('INVALID', `${label}无效`);
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  return value === undefined ? fallback : boolean(value, '布尔字段');
}

function playerPatch(value: unknown, maySetHp: boolean): PlayerUpdatePatch {
  if (!isRecord(value)) throw new DomainError('INVALID', '更新无效');
  const patch: PlayerUpdatePatch = {};
  if (value.name !== undefined) patch.name = shortText(value.name, 120);
  if (value.color !== undefined) patch.color = color(value.color);
  if (value.avatar !== undefined) patch.avatar = optionalAssetUrl(value.avatar);
  if (maySetHp && value.hp !== undefined) patch.hp = value.hp === null ? null : hp(value.hp);
  if (maySetHp && value.conditions !== undefined) patch.conditions = tokenConditions(value.conditions);
  if (Object.keys(patch).length === 0) throw new DomainError('INVALID', '没有可更新字段');
  return patch;
}

function combatantPatch(value: unknown): { name?: string; value?: number; hidden?: boolean; defeated?: boolean; group?: string | null; turnState?: 'normal' | 'ready' | 'delayed' } {
  if (!isRecord(value)) throw new DomainError('INVALID', '战斗单位更新无效');
  const patch: { name?: string; value?: number; hidden?: boolean; defeated?: boolean; group?: string | null; turnState?: 'normal' | 'ready' | 'delayed' } = {};
  if (value.name !== undefined) patch.name = shortText(value.name, 120);
  if (value.value !== undefined) patch.value = boundedNumber(value.value, -100, 100);
  if (value.hidden !== undefined) patch.hidden = boolean(value.hidden, '先攻可见性');
  if (value.defeated !== undefined) patch.defeated = boolean(value.defeated, '战败状态');
  if (value.group !== undefined) patch.group = value.group === null || value.group === '' ? null : shortText(value.group, 80);
  if (value.turnState !== undefined) {
    if (value.turnState !== 'normal' && value.turnState !== 'ready' && value.turnState !== 'delayed') throw new DomainError('INVALID', '行动状态无效');
    patch.turnState = value.turnState;
  }
  if (Object.keys(patch).length === 0) throw new DomainError('INVALID', '没有可更新字段');
  return patch;
}

const TOKEN_CONDITION_IDS: readonly TokenConditionId[] = [
  'prone', 'grappled', 'restrained', 'stunned', 'unconscious', 'invisible', 'concentrating', 'dead',
];

function tokenConditions(value: unknown): TokenCondition[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > TOKEN_CONDITION_IDS.length) {
    throw new DomainError('INVALID', 'Token 状态列表无效');
  }
  const seen = new Set<TokenConditionId>();
  return value.map(item => {
    if (!isRecord(item) || !TOKEN_CONDITION_IDS.includes(item.id as TokenConditionId) || seen.has(item.id as TokenConditionId)) {
      throw new DomainError('INVALID', 'Token 状态无效');
    }
    const conditionId = item.id as TokenConditionId;
    seen.add(conditionId);
    const remainingRounds = item.remainingRounds === null || item.remainingRounds === undefined
      ? null
      : boundedInteger(item.remainingRounds, 1, 99, '状态持续轮数');
    return { id: conditionId, remainingRounds };
  });
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new DomainError('INVALID', `${label}无效`);
  }
  return value;
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
  if (url.startsWith('/api/rooms/') || url.startsWith('/api/token/')) return url;
  throw new DomainError('INVALID', '素材必须引用本站资料库或当前房间的私有素材');
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

// Keep the fog-cell contract referenced in the authorization bundle alongside
// the setFog validation rules.
void FOG_CELL;
