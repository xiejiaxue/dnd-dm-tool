import {
  type Campaign,
  DEFAULT_TOKEN_SIZE,
  fogGridSize,
  type GridConfig,
  type InitiativeEntry,
  type Op,
  type PlayArea,
  type PlayerToken,
  type Role,
  type Scene,
  type SceneFolder,
  type Token,
} from '../../shared/types';
import { addFogReveal, fogExtent } from '../../shared/fog-rects';

/** Roles are assigned by D1. They are never accepted from a browser payload. */
export type RoomRole = 'host' | 'dm' | 'assistant_dm' | 'player' | 'spectator';

export interface RoomActor {
  userId: string;
  memberId: string;
  role: RoomRole;
  accessEpoch: number;
}

export interface PersistedRoomState {
  schemaVersion: 1;
  revision: number;
  currentCampaignId: string;
  currentSceneId: string;
  campaigns: Record<string, Campaign>;
  scenes: Record<string, Scene>;
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
    mapScale: 1,
    grid: { ...DEFAULT_GRID, offset: [...DEFAULT_GRID.offset] as [number, number] },
    playArea: { ...DEFAULT_PLAY },
    tokens: [],
    players: [],
    walls: [],
    initiative: [],
    favorites: [],
    fogReveals: [],
    fogVersion: 2,
    unlocked: true,
  };
}

export function createCampaign(name: string, firstSceneId: string): Campaign {
  return {
    id: newOpaqueId('campaign'),
    name: normalizeName(name, '未命名战役'),
    sceneIds: [firstSceneId],
    sceneFolders: [],
    sceneFolderAssignments: {},
    sceneFoldersInitialized: true,
    enemies: [],
    npcs: [],
  };
}

export function createInitialRoomState(roomName: string, campaignName: string): PersistedRoomState {
  const scene = createScene(`${roomName} 场景`);
  const campaign = createCampaign(campaignName, scene.id);
  return {
    schemaVersion: 1,
    revision: 0,
    currentCampaignId: campaign.id,
    currentSceneId: scene.id,
    campaigns: { [campaign.id]: campaign },
    scenes: { [scene.id]: scene },
  };
}

export function projectRoomState(state: PersistedRoomState, actor: RoomActor): RoomProjection {
  const scene = state.scenes[state.currentSceneId];
  const campaign = state.campaigns[state.currentCampaignId];
  if (!scene || !campaign) throw new Error('Room state has no active scene or campaign');

  const canManage = isRoomModerator(actor.role);
  if (canManage) {
    return {
      type: 'state',
      revision: state.revision,
      role: 'dm',
      scene: structuredClone(scene),
      campaign: structuredClone(campaign),
      viewer: { userId: actor.userId, roomMemberId: actor.memberId, roomRole: actor.role, canManage },
    };
  }

  // A player must never receive another player's stable account identifier.
  // Tokens without a visibility model are still intentionally visible; strong
  // fog needs derived map tiles and is documented as a separate feature.
  const playerScene = structuredClone(scene);
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
    campaign: { ...structuredClone(campaign), enemies: [], npcs: [] },
    viewer: { userId: actor.userId, roomMemberId: actor.memberId, roomRole: actor.role, canManage: false },
  };
}

export function ensurePlayerToken(state: PersistedRoomState, actor: RoomActor): boolean {
  if (actor.role !== 'player') return false;
  const scene = activeScene(state);
  if (scene.players.some((player) => player.sessionId === actor.userId)) return false;
  scene.players.push({
    id: newOpaqueId('player'),
    kind: 'player',
    name: '新玩家',
    entryId: null,
    x: 200 + scene.players.length * 60,
    y: 200,
    size: DEFAULT_TOKEN_SIZE,
    avatar: '',
    color: '#38a169',
    sessionId: actor.userId,
  });
  return true;
}

/**
 * Upgrade player tokens created before the shared 100px token-size contract.
 * This is deliberately server-owned: clients cannot resize characters through
 * this migration path, but every active room converges as soon as it reconnects.
 */
export function normalizeLegacyPlayerTokenSizes(state: PersistedRoomState): PlayerToken[] {
  const active = activeScene(state);
  const changedActivePlayers: PlayerToken[] = [];
  for (const scene of Object.values(state.scenes)) {
    for (const player of scene.players) {
      if (player.size === DEFAULT_TOKEN_SIZE) continue;
      player.size = DEFAULT_TOKEN_SIZE;
      if (scene.id === active.id) changedActivePlayers.push(structuredClone(player));
    }
  }
  return changedActivePlayers;
}

export function applyOperation(state: PersistedRoomState, op: Op): void {
  const scene = activeScene(state);
  switch (op.op) {
    case 'addToken': {
      if (!scene.tokens.some((item) => item.id === op.token.id)) {
        const next = { ...op.token };
        if ((next.kind === 'monster' || next.kind === 'npc') && next.entryId) {
          const same = scene.tokens.filter((item) => item.kind === next.kind && item.entryId === next.entryId);
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
      scene.tokens = scene.tokens.filter((item) => item.id !== op.tokenId);
      scene.initiative = scene.initiative.filter((entry) => entry.tokenId !== op.tokenId);
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
      scene.fog = undefined;
      scene.fogReveals = [];
      scene.fogVersion = 2;
      return;
    case 'updateMapScale':
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
    case 'upsertNpc': {
      const campaign = activeCampaign(state);
      const npcs = campaign.npcs ?? (campaign.npcs = []);
      const index = npcs.findIndex((npc) => npc.id === op.npc.id);
      if (index >= 0) npcs[index] = structuredClone(op.npc);
      else npcs.push(structuredClone(op.npc));
      return;
    }
    case 'removeNpc': {
      const campaign = activeCampaign(state);
      campaign.npcs = (campaign.npcs ?? []).filter((npc) => npc.id !== op.npcId);
      return;
    }
    case 'switchCampaign': {
      const campaign = state.campaigns[op.campaignId];
      if (!campaign) return;
      state.currentCampaignId = campaign.id;
      state.currentSceneId = campaign.sceneIds[0] ?? state.currentSceneId;
      return;
    }
    case 'submitInitiative': {
      const existing = op.sessionId
        ? scene.initiative.find((entry) => entry.sessionId === op.sessionId)
        : scene.initiative.find((entry) => entry.source === 'player' && entry.name === op.name);
      if (existing) {
        existing.name = op.name;
        existing.value = op.value;
        existing.tokenId = op.tokenId ?? existing.tokenId;
      } else {
        scene.initiative.push({
          id: newOpaqueId('initiative'),
          name: op.name,
          value: op.value,
          source: 'player',
          sessionId: op.sessionId ?? null,
          tokenId: op.tokenId,
          active: false,
        });
      }
      scene.initiative = sortInitiative(scene.initiative);
      return;
    }
    case 'addToInitiative': {
      const existing = op.tokenId
        ? scene.initiative.find((entry) => entry.tokenId === op.tokenId)
        : undefined;
      if (existing) {
        existing.name = op.name;
        existing.value = op.value;
        existing.source = 'dm';
      } else {
        scene.initiative.push({
          id: newOpaqueId('initiative'),
          name: op.name,
          value: op.value,
          source: 'dm',
          sessionId: null,
          tokenId: op.tokenId,
          active: false,
        });
      }
      scene.initiative = sortInitiative(scene.initiative);
      return;
    }
    case 'removeFromInitiative': {
      const linkedCombatantTokenId = scene.initiative.find((entry) => entry.id === op.entryId)?.tokenId;
      scene.initiative = scene.initiative.filter((entry) => entry.id !== op.entryId);
      if (linkedCombatantTokenId && scene.tokens.some((token) => token.id === linkedCombatantTokenId && (token.kind === 'monster' || token.kind === 'npc'))) {
        scene.tokens = scene.tokens.filter((token) => token.id !== linkedCombatantTokenId);
      }
      return;
    }
    case 'advanceTurn':
      scene.initiative = advanceInitiative(scene.initiative);
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
    case 'setFog': {
      const fog = ensureFog(scene);
      for (const cell of op.cells) if (cell >= 0 && cell < fog.length) fog[cell] = op.revealed;
      return;
    }
    case 'revealFogRect':
      scene.fogReveals = addFogReveal(scene.fogReveals ?? [], op.rect);
      return;
    case 'revealAllFog': {
      const { width, height } = fogExtent(scene);
      scene.fog = undefined;
      scene.fogReveals = [{ x: 0, y: 0, w: width, h: height }];
      return;
    }
    case 'coverAllFog':
      scene.fog = undefined;
      scene.fogReveals = [];
      return;
  }
}

export function activeScene(state: PersistedRoomState): Scene {
  const scene = state.scenes[state.currentSceneId];
  if (!scene) throw new DomainError('CORRUPT_STATE', '找不到当前场景');
  return scene;
}

export function activeCampaign(state: PersistedRoomState): Campaign {
  const campaign = state.campaigns[state.currentCampaignId];
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
  if (campaign.sceneFolderAssignments) delete campaign.sceneFolderAssignments[sceneId];
  delete state.scenes[sceneId];
  if (state.currentSceneId === sceneId) state.currentSceneId = campaign.sceneIds[0];
  return true;
}

export function createSceneFolder(state: PersistedRoomState, name: string): SceneFolder {
  const campaign = activeCampaign(state);
  const normalized = normalizeName(name, '未命名章节');
  const folders = campaign.sceneFolders ??= [];
  if (folders.length >= 100) throw new DomainError('INVALID', '一个战役最多创建 100 个场景文件夹');
  if (folders.some(folder => folder.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
    throw new DomainError('INVALID', '同名场景文件夹已存在');
  }
  const folder = { id: newOpaqueId('folder'), name: normalized };
  folders.push(folder);
  campaign.sceneFolderAssignments ??= {};
  campaign.sceneFoldersInitialized = true;
  return folder;
}

export function renameSceneFolder(state: PersistedRoomState, folderId: string, name: string): void {
  const campaign = activeCampaign(state);
  const folder = campaign.sceneFolders?.find(candidate => candidate.id === folderId);
  if (!folder) throw new DomainError('NOT_FOUND', '找不到场景文件夹');
  const normalized = normalizeName(name, folder.name);
  if (campaign.sceneFolders?.some(candidate => candidate.id !== folderId
    && candidate.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
    throw new DomainError('INVALID', '同名场景文件夹已存在');
  }
  folder.name = normalized;
}

/** Deleting organization never deletes maps; affected scenes become ungrouped. */
export function deleteSceneFolder(state: PersistedRoomState, folderId: string): void {
  const campaign = activeCampaign(state);
  if (!campaign.sceneFolders?.some(folder => folder.id === folderId)) {
    throw new DomainError('NOT_FOUND', '找不到场景文件夹');
  }
  campaign.sceneFolders = campaign.sceneFolders.filter(folder => folder.id !== folderId);
  const assignments = campaign.sceneFolderAssignments ??= {};
  for (const [sceneId, assignedFolderId] of Object.entries(assignments)) {
    if (assignedFolderId === folderId) delete assignments[sceneId];
  }
  campaign.sceneFoldersInitialized = true;
}

export function moveSceneToFolder(state: PersistedRoomState, sceneId: string, folderId: string | null): void {
  const campaign = activeCampaign(state);
  if (!campaign.sceneIds.includes(sceneId) || !state.scenes[sceneId]) {
    throw new DomainError('NOT_FOUND', '找不到场景');
  }
  if (folderId && !campaign.sceneFolders?.some(folder => folder.id === folderId)) {
    throw new DomainError('NOT_FOUND', '找不到场景文件夹');
  }
  const assignments = campaign.sceneFolderAssignments ??= {};
  if (folderId) assignments[sceneId] = folderId;
  else delete assignments[sceneId];
  campaign.sceneFoldersInitialized = true;
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
  const { cols, rows } = fogGridSize(scene);
  const length = cols * rows;
  if (!scene.fog || scene.fog.length !== length) scene.fog = new Array(length).fill(false);
  scene.fogVersion = 2;
  return scene.fog;
}

function findToken(scene: Scene, tokenId: string): Token | PlayerToken | undefined {
  return scene.tokens.find((token) => token.id === tokenId) ?? scene.players.find((token) => token.id === tokenId);
}

function sortInitiative(entries: InitiativeEntry[]): InitiativeEntry[] {
  return [...entries].sort((a, b) => b.value - a.value);
}

function advanceInitiative(entries: InitiativeEntry[]): InitiativeEntry[] {
  const next = entries.map((entry) => ({ ...entry, active: false }));
  if (next.length === 0) return next;
  const current = entries.find((entry) => entry.active);
  const index = current ? (next.findIndex((entry) => entry.id === current.id) + 1) % next.length : 0;
  next[index].active = true;
  return next;
}

function normalizeName(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 120);
  return normalized || fallback;
}
