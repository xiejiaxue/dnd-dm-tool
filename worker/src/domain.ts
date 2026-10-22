import {
  type Campaign,
  DEFAULT_TOKEN_SIZE,
  type Encounter,
  fogGridSize,
  type GridConfig,
  type InitiativeEntry,
  type NpcRecord,
  type Op,
  type PlayArea,
  type PlayerToken,
  type Role,
  type Scene,
  type SceneConfigurationPatch,
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
  /** Platform owners may inspect complete room state but do not gain mutation
   * rights unless they also hold a moderator role in this room. */
  platformOwner?: boolean;
  /** Active room Actor claim, resolved from D1 by the Worker. Browser payloads
   * can never choose these values. */
  claimedActor?: {
    id: string;
    name: string;
    avatar: string;
    color: string;
  };
}

export interface PersistedRoomState {
  schemaVersion: 1;
  revision: number;
  currentCampaignId: string;
  currentSceneId: string;
  campaigns: Record<string, Campaign>;
  scenes: Record<string, Scene>;
  encounters: Record<string, Encounter>;
  currentEncounterId: string | null;
}

export interface RoomProjection {
  type: 'state';
  revision: number;
  role: Role;
  scene: Scene;
  campaign: Campaign;
  encounter: Encounter | null;
  viewer: {
    userId: string;
    roomMemberId: string;
    roomRole: RoomRole;
    canManage: boolean;
    canReadAll: boolean;
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

export function canReadAllRoomData(actor: RoomActor): boolean {
  return actor.platformOwner === true || isRoomModerator(actor.role);
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
    initialView: { x: 0, y: 0, scale: 1 },
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
    encounters: {},
    currentEncounterId: null,
  };
}

export function projectRoomState(state: PersistedRoomState, actor: RoomActor): RoomProjection {
  const scene = state.scenes[state.currentSceneId];
  const campaign = state.campaigns[state.currentCampaignId];
  if (!scene || !campaign) throw new Error('Room state has no active scene or campaign');

  const canManage = isRoomModerator(actor.role);
  const canReadAll = canReadAllRoomData(actor);
  const encounter = encounterForScene(state, scene.id);
  if (canReadAll) {
    const visibleScene = structuredClone(scene);
    const visibleEncounter = projectEncounter(encounter, actor, true);
    visibleScene.initiative = structuredClone(visibleEncounter?.combatants ?? []);
    if (!canManage) {
      visibleScene.players = visibleScene.players.map(player => ({
        ...player,
        sessionId: player.sessionId === actor.userId ? actor.userId : null,
      }));
    }
    return {
      type: 'state',
      revision: state.revision,
      role: canManage ? 'dm' : 'player',
      scene: visibleScene,
      campaign: structuredClone(campaign),
      encounter: visibleEncounter,
      viewer: { userId: actor.userId, roomMemberId: actor.memberId, roomRole: actor.role, canManage, canReadAll },
    };
  }

  // A player must never receive another player's stable account identifier or
  // any hidden token/NPC archive fields. Visibility is enforced here, before
  // serialization, rather than by client-side rendering conditions.
  const playerScene = structuredClone(scene);
  const projectedNpcRecords = projectCampaignNpcs(campaign.npcs ?? []);
  const projectedNpcIds = new Set(projectedNpcRecords.map(npc => npc.id));
  playerScene.tokens = scene.tokens.flatMap(token => token.hidden === true
    ? []
    : [projectPlayerToken(token, campaign.npcs ?? [], projectedNpcIds)]);
  const playerEncounter = projectEncounter(encounter, actor, false, scene, playerScene.tokens);
  playerScene.players = playerScene.players.map((player) => ({
    ...player,
    sessionId: player.sessionId === actor.userId ? actor.userId : null,
  }));
  playerScene.initiative = structuredClone(playerEncounter?.combatants ?? []);

  return {
    type: 'state',
    revision: state.revision,
    role: 'player',
    scene: playerScene,
    // Encounter-library contents are DM-only. The campaign name and unlocked
    // scene ids are enough for the existing player board.
    campaign: { ...structuredClone(campaign), enemies: [], npcs: projectedNpcRecords },
    encounter: playerEncounter,
    viewer: { userId: actor.userId, roomMemberId: actor.memberId, roomRole: actor.role, canManage: false, canReadAll: false },
  };
}

function projectEncounter(
  encounter: Encounter | null,
  actor: RoomActor,
  canManage: boolean,
  scene?: Scene,
  projectedTokens?: Token[],
): Encounter | null {
  if (!encounter) return null;
  const visible = structuredClone(encounter);
  if (!canManage) {
    const sourceTokens = new Map((scene?.tokens ?? []).map(token => [token.id, token]));
    const playerTokens = new Map((projectedTokens ?? []).map(token => [token.id, token]));
    const activeId = encounter.turn === null ? null : encounter.combatants[encounter.turn]?.id ?? null;
    visible.combatants = encounter.combatants.flatMap((entry) => {
      const sourceToken = entry.tokenId ? sourceTokens.get(entry.tokenId) : undefined;
      const inheritedHidden = sourceToken?.hidden === true;
      if ((entry.hidden ?? inheritedHidden) === true) return [];
      const playerToken = entry.tokenId ? playerTokens.get(entry.tokenId) : undefined;
      const projected = structuredClone(entry);
      projected.sessionId = entry.sessionId === actor.userId ? actor.userId : null;
      projected.tokenId = playerToken || !sourceToken ? entry.tokenId : null;
      if (sourceToken?.publicName?.trim()) {
        projected.name = sourceToken.number != null
          ? `${sourceToken.publicName.trim()} #${sourceToken.number}`
          : sourceToken.publicName.trim();
      }
      delete projected.hidden;
      return [projected];
    });
    visible.turn = visible.status === 'active' && activeId
      ? (() => {
          const index = visible.combatants.findIndex(entry => entry.id === activeId);
          return index >= 0 ? index : null;
        })()
      : null;
    visible.combatants.forEach((entry, index) => { entry.active = visible.turn === index; });
  }
  return visible;
}

function projectPlayerToken(token: Token, npcs: readonly NpcRecord[], projectedNpcIds: ReadonlySet<string>): Token {
  const projected = structuredClone(token);
  const publicName = token.publicName?.trim();
  if (publicName) {
    projected.name = publicName;
    projected.entryId = null;
  } else if (token.kind === 'npc' && token.entryId?.startsWith('npc:')) {
    const npcId = token.entryId.slice(4);
    if (!projectedNpcIds.has(npcId) || !(npcs.some(npc => npc.id === npcId))) projected.entryId = null;
  }
  delete projected.hidden;
  delete projected.publicName;
  delete projected.hpRatio;
  const hpVisibility = token.hpVisibility ?? 'value';
  if (hpVisibility === 'none') {
    delete projected.hp;
  } else if (hpVisibility === 'bar') {
    projected.hpRatio = token.hp ? Math.max(0, Math.min(100, token.hp.current / token.hp.max * 100)) : 0;
    delete projected.hp;
  }
  return projected;
}

function projectCampaignNpcs(npcs: readonly NpcRecord[]): NpcRecord[] {
  return npcs.flatMap((npc) => {
    const playerAccess = npc.playerAccess ?? 'none';
    if (playerAccess === 'none') return [];
    const publicDescription = npc.publicDescription?.trim() ?? '';
    const publicStatReference = playerAccess === 'observer' && npc.statReference?.kind !== 'npc'
      ? structuredClone(npc.statReference)
      : undefined;
    return [{
      id: npc.id,
      name: npc.name,
      aliases: [],
      role: '',
      location: '',
      status: 'active' as const,
      importance: npc.importance,
      faction: '公开人物',
      groupPath: ['公开人物'],
      statReference: publicStatReference,
      notesMarkdown: publicDescription,
      playerAccess,
      publicDescription,
      sourceFile: null,
      updatedAt: npc.updatedAt,
    }];
  });
}

export function ensurePlayerToken(state: PersistedRoomState, actor: RoomActor): boolean {
  if (actor.role !== 'player') return false;
  const scene = activeScene(state);
  const claimed = actor.claimedActor;
  const existing = scene.players.find((player) => player.sessionId === actor.userId)
    ?? (claimed ? scene.players.find((player) => player.actorId === claimed.id && player.sessionId === null) : undefined);
  if (existing) {
    let changed = false;
    if (existing.sessionId !== actor.userId) { existing.sessionId = actor.userId; changed = true; }
    if (claimed && existing.actorId !== claimed.id) { existing.actorId = claimed.id; changed = true; }
    if (claimed && existing.name !== claimed.name) { existing.name = claimed.name; changed = true; }
    if (claimed && existing.avatar !== claimed.avatar) { existing.avatar = claimed.avatar; changed = true; }
    if (claimed && existing.color !== claimed.color) { existing.color = claimed.color; changed = true; }
    return changed;
  }
  scene.players.push({
    id: newOpaqueId('player'),
    kind: 'player',
    actorId: claimed?.id ?? null,
    name: claimed?.name ?? '新玩家',
    entryId: null,
    x: 200 + scene.players.length * 60,
    y: 200,
    size: DEFAULT_TOKEN_SIZE,
    avatar: claimed?.avatar ?? '',
    color: claimed?.color ?? '#38a169',
    sessionId: actor.userId,
  });
  return true;
}

export function playerTokenNeedsProvision(state: PersistedRoomState, actor: RoomActor): boolean {
  if (actor.role !== 'player') return false;
  const scene = activeScene(state);
  const claimed = actor.claimedActor;
  const existing = scene.players.find((player) => player.sessionId === actor.userId)
    ?? (claimed ? scene.players.find((player) => player.actorId === claimed.id && player.sessionId === null) : undefined);
  if (!existing) return true;
  return Boolean(claimed && (
    existing.actorId !== claimed.id
    || existing.name !== claimed.name
    || existing.avatar !== claimed.avatar
    || existing.color !== claimed.color
  ));
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

export function encounterForScene(state: PersistedRoomState, sceneId: string): Encounter | null {
  const selected = state.currentEncounterId ? state.encounters[state.currentEncounterId] : undefined;
  if (selected?.sceneId === sceneId) return selected;
  const matches = Object.values(state.encounters).filter((encounter) => encounter.sceneId === sceneId);
  return matches[matches.length - 1] ?? null;
}

export function currentEncounter(state: PersistedRoomState): Encounter | null {
  return encounterForScene(state, activeScene(state).id);
}

export function createEncounter(state: PersistedRoomState): Encounter {
  const existing = currentEncounter(state);
  if (existing && existing.status !== 'ended') throw new DomainError('INVALID', '当前场景已有未结束的战斗');
  const scene = activeScene(state);
  const encounter: Encounter = {
    id: newOpaqueId('encounter'),
    sceneId: scene.id,
    name: `${scene.name} 遭遇`,
    status: 'setup',
    round: 0,
    turn: null,
    combatants: [],
    createdAt: Date.now(),
    endedAt: null,
  };
  state.encounters[encounter.id] = encounter;
  state.currentEncounterId = encounter.id;
  return encounter;
}

export function duplicateEncounter(state: PersistedRoomState): Encounter {
  const source = currentEncounter(state);
  if (!source) throw new DomainError('NOT_FOUND', '没有可复制的战斗');
  if (source.status !== 'ended') {
    source.status = 'ended';
    source.turn = null;
    source.endedAt = Date.now();
    synchronizeActiveCombatant(source);
  }
  const encounter: Encounter = {
    id: newOpaqueId('encounter'), sceneId: source.sceneId, name: `${source.name} 副本`,
    status: 'setup', round: 0, turn: null,
    combatants: source.combatants.map(entry => ({ ...structuredClone(entry), id: newOpaqueId('initiative'), active: false, defeated: false, turnState: 'normal' })),
    createdAt: Date.now(), endedAt: null,
  };
  state.encounters[encounter.id] = encounter;
  state.currentEncounterId = encounter.id;
  return encounter;
}

function ensureEncounter(state: PersistedRoomState): Encounter {
  const encounter = currentEncounter(state);
  return encounter && encounter.status !== 'ended' ? encounter : createEncounter(state);
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
    case 'removeToken': {
      scene.tokens = scene.tokens.filter((item) => item.id !== op.tokenId);
      detachTokenFromEncounters(state, op.tokenId);
      return;
    }
    case 'updateToken': {
      const target = scene.tokens.find((item) => item.id === op.tokenId);
      if (target) {
        const { hp, ...patch } = op.patch;
        Object.assign(target, patch);
        if ('hp' in op.patch) {
          if (hp === null) delete target.hp;
          else target.hp = hp;
        }
        if (op.patch.conditions) synchronizeCombatantDefeated(state, target);
      }
      return;
    }
    case 'addPlayer':
      if (!scene.players.some((item) => item.id === op.player.id)) scene.players.push(op.player);
      return;
    case 'removePlayer':
      scene.players = scene.players.filter((item) => item.id !== op.tokenId);
      detachTokenFromEncounters(state, op.tokenId);
      return;
    case 'updatePlayer': {
      const target = scene.players.find((item) => item.id === op.tokenId);
      if (target) {
        const { hp, ...patch } = op.patch;
        Object.assign(target, patch);
        if ('hp' in op.patch) {
          if (hp === null) delete target.hp;
          else target.hp = hp;
        }
        if (op.patch.conditions) synchronizeCombatantDefeated(state, target);
      }
      return;
    }
    case 'addWall':
      if (!scene.walls.some((item) => item.id === op.wall.id)) scene.walls.push(op.wall);
      return;
    case 'removeWall':
      scene.walls = scene.walls.filter((item) => item.id !== op.wallId);
      return;
    case 'updateWall': {
      const wall = scene.walls.find((item) => item.id === op.wallId);
      if (wall) Object.assign(wall, op.patch);
      return;
    }
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
      state.currentEncounterId = encounterForScene(state, state.currentSceneId)?.id ?? null;
      return;
    }
    case 'submitInitiative': {
      const encounter = ensureEncounter(state);
      const existing = op.sessionId
        ? encounter.combatants.find((entry) => entry.sessionId === op.sessionId)
        : encounter.combatants.find((entry) => entry.source === 'player' && entry.name === op.name);
      if (existing) {
        existing.name = op.name;
        existing.value = op.value;
        existing.tokenId = op.tokenId ?? existing.tokenId;
      } else {
        encounter.combatants.push({
          id: newOpaqueId('initiative'),
          name: op.name,
          value: op.value,
          source: 'player',
          sessionId: op.sessionId ?? null,
          tokenId: op.tokenId,
          active: false,
        });
      }
      sortEncounterCombatants(encounter);
      return;
    }
    case 'addToInitiative': {
      const encounter = ensureEncounter(state);
      const existing = op.tokenId
        ? encounter.combatants.find((entry) => entry.tokenId === op.tokenId)
        : undefined;
      if (existing) {
        existing.name = op.name;
        existing.value = op.value;
        existing.source = 'dm';
      } else {
        encounter.combatants.push({
          id: newOpaqueId('initiative'),
          name: op.name,
          value: op.value,
          source: 'dm',
          sessionId: null,
          tokenId: op.tokenId,
          active: false,
        });
      }
      sortEncounterCombatants(encounter);
      return;
    }
    case 'removeFromInitiative': {
      const encounter = currentEncounter(state);
      if (encounter) removeCombatant(encounter, op.entryId);
      return;
    }
    case 'setCombatantHidden': {
      const encounter = currentEncounter(state);
      const combatant = encounter?.combatants.find(entry => entry.id === op.entryId);
      if (combatant) combatant.hidden = op.hidden;
      return;
    }
    case 'updateCombatant': {
      const encounter = currentEncounter(state);
      const combatant = encounter?.combatants.find(entry => entry.id === op.entryId);
      if (!encounter || !combatant) return;
      const valueChanged = op.patch.value !== undefined && op.patch.value !== combatant.value;
      Object.assign(combatant, op.patch);
      if (op.patch.defeated !== undefined && combatant.tokenId) {
        synchronizeTokenDefeated(scene, combatant.tokenId, op.patch.defeated);
      }
      if (valueChanged) sortEncounterCombatants(encounter);
      else synchronizeActiveCombatant(encounter);
      return;
    }
    case 'createEncounter':
      createEncounter(state);
      return;
    case 'duplicateEncounter':
      duplicateEncounter(state);
      return;
    case 'startEncounter': {
      const encounter = currentEncounter(state);
      if (!encounter) throw new DomainError('NOT_FOUND', '请先创建战斗遭遇');
      startEncounter(encounter);
      return;
    }
    case 'endEncounter': {
      const encounter = currentEncounter(state);
      if (!encounter || encounter.status === 'ended') return;
      encounter.status = 'ended';
      encounter.turn = null;
      encounter.endedAt = Date.now();
      synchronizeActiveCombatant(encounter);
      return;
    }
    case 'advanceTurn': {
      const encounter = currentEncounter(state);
      if (!encounter) return;
      if (encounter.status === 'setup') startEncounter(encounter);
      else if (nextEncounterTurn(encounter)) tickRoundConditions(scene);
      return;
    }
    case 'nextTurn': {
      const encounter = requireActiveEncounter(state);
      if (nextEncounterTurn(encounter)) tickRoundConditions(scene);
      return;
    }
    case 'endMyTurn': {
      const encounter = requireActiveEncounter(state);
      if (nextEncounterTurn(encounter)) tickRoundConditions(scene);
      return;
    }
    case 'previousTurn': {
      const encounter = requireActiveEncounter(state);
      previousEncounterTurn(encounter);
      return;
    }
    case 'nextRound': {
      const encounter = requireActiveEncounter(state);
      encounter.round += 1;
      encounter.turn = firstEligibleCombatant(encounter);
      tickRoundConditions(scene);
      synchronizeActiveCombatant(encounter);
      return;
    }
    case 'previousRound': {
      const encounter = requireActiveEncounter(state);
      if (encounter.round > 1) {
        encounter.round -= 1;
        const eligible = encounter.combatants.flatMap((entry, index) => entry.defeated ? [] : [index]);
        encounter.turn = eligible.at(-1) ?? null;
        synchronizeActiveCombatant(encounter);
      }
      return;
    }
    case 'reorderInitiative': {
      const encounter = currentEncounter(state);
      if (!encounter) return;
      const currentId = currentCombatantId(encounter);
      const byId = new Map(encounter.combatants.map((entry) => [entry.id, entry]));
      const ordered: InitiativeEntry[] = [];
      for (const entryId of op.order) {
        const entry = byId.get(entryId);
        if (entry) { ordered.push(entry); byId.delete(entryId); }
      }
      encounter.combatants = [...ordered, ...byId.values()];
      restoreCurrentCombatant(encounter, currentId);
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
    case 'restoreFog':
      scene.fog = op.fog ? [...op.fog] : undefined;
      scene.fogReveals = op.fogReveals.map((rect) => ({ ...rect }));
      scene.fogVersion = 2;
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
  for (const encounter of Object.values(state.encounters)) {
    if (encounter.sceneId === sceneId) delete state.encounters[encounter.id];
  }
  if (state.currentSceneId === sceneId) state.currentSceneId = campaign.sceneIds[0];
  state.currentEncounterId = encounterForScene(state, state.currentSceneId)?.id ?? null;
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
  state.currentEncounterId = encounterForScene(state, sceneId)?.id ?? null;
}

export function setSceneUnlocked(state: PersistedRoomState, sceneId: string, unlocked: boolean): void {
  const scene = state.scenes[sceneId];
  if (!scene || !activeCampaign(state).sceneIds.includes(sceneId)) throw new DomainError('NOT_FOUND', '找不到场景');
  scene.unlocked = unlocked;
}

export function updateSceneConfiguration(state: PersistedRoomState, sceneId: string, patch: SceneConfigurationPatch): Scene {
  const scene = state.scenes[sceneId];
  if (!scene || !activeCampaign(state).sceneIds.includes(sceneId)) throw new DomainError('NOT_FOUND', '找不到场景');
  if (patch.name !== undefined) scene.name = normalizeName(patch.name, scene.name);
  if (patch.unlocked !== undefined) scene.unlocked = patch.unlocked;
  if (patch.mapScale !== undefined) scene.mapScale = patch.mapScale;
  if (patch.grid) {
    scene.grid = {
      ...scene.grid,
      ...patch.grid,
      ...(patch.grid.offset ? { offset: [...patch.grid.offset] as [number, number] } : {}),
    };
  }
  if (patch.playArea) scene.playArea = { ...patch.playArea };
  if (patch.initialView) scene.initialView = { ...patch.initialView };
  return scene;
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

function detachTokenFromEncounters(state: PersistedRoomState, tokenId: string): void {
  for (const encounter of Object.values(state.encounters)) {
    for (const combatant of encounter.combatants) {
      if (combatant.tokenId === tokenId) combatant.tokenId = null;
    }
  }
}

function sortEncounterCombatants(encounter: Encounter): void {
  const currentId = currentCombatantId(encounter);
  encounter.combatants = [...encounter.combatants].sort((a, b) => b.value - a.value);
  restoreCurrentCombatant(encounter, currentId);
}

function currentCombatantId(encounter: Encounter): string | null {
  if (encounter.turn !== null) return encounter.combatants[encounter.turn]?.id ?? null;
  return encounter.combatants.find((entry) => entry.active)?.id ?? null;
}

function restoreCurrentCombatant(encounter: Encounter, combatantId: string | null): void {
  encounter.turn = encounter.status === 'active' && combatantId
    ? Math.max(0, encounter.combatants.findIndex((entry) => entry.id === combatantId))
    : encounter.status === 'active' && encounter.combatants.length ? Math.min(encounter.turn ?? 0, encounter.combatants.length - 1) : null;
  synchronizeActiveCombatant(encounter);
}

function synchronizeActiveCombatant(encounter: Encounter): void {
  encounter.combatants.forEach((entry, index) => { entry.active = encounter.status === 'active' && encounter.turn === index; });
}

function removeCombatant(encounter: Encounter, combatantId: string): void {
  const currentId = currentCombatantId(encounter);
  encounter.combatants = encounter.combatants.filter((entry) => entry.id !== combatantId);
  restoreCurrentCombatant(encounter, currentId === combatantId ? encounter.combatants[Math.min(encounter.turn ?? 0, encounter.combatants.length - 1)]?.id ?? null : currentId);
}

function startEncounter(encounter: Encounter): void {
  if (encounter.status === 'ended') throw new DomainError('INVALID', '已结束的战斗不能重新开始，请新建遭遇');
  if (!encounter.combatants.length) throw new DomainError('INVALID', '至少加入一个战斗单位后才能开始');
  if (!encounter.combatants.some(entry => !entry.defeated)) throw new DomainError('INVALID', '至少保留一个未战败单位后才能开始');
  encounter.status = 'active';
  encounter.round = 1;
  encounter.turn = firstEligibleCombatant(encounter);
  encounter.endedAt = null;
  synchronizeActiveCombatant(encounter);
}

function requireActiveEncounter(state: PersistedRoomState): Encounter {
  const encounter = currentEncounter(state);
  if (!encounter || encounter.status !== 'active') throw new DomainError('INVALID', '战斗尚未开始');
  return encounter;
}

/** Returns true when navigation crossed into a new round. */
function nextEncounterTurn(encounter: Encounter): boolean {
  if (!encounter.combatants.length) {
    encounter.turn = null;
    synchronizeActiveCombatant(encounter);
    return false;
  }
  const eligible = encounter.combatants.flatMap((entry, index) => entry.defeated ? [] : [index]);
  if (!eligible.length) {
    encounter.turn = null;
    synchronizeActiveCombatant(encounter);
    return false;
  }
  const current = encounter.turn ?? -1;
  const next = eligible.find(index => index > current);
  const crossedRound = next === undefined && current >= 0;
  encounter.turn = next ?? eligible[0];
  if (crossedRound) encounter.round += 1;
  synchronizeActiveCombatant(encounter);
  return crossedRound;
}

function previousEncounterTurn(encounter: Encounter): void {
  if (!encounter.combatants.length) {
    encounter.turn = null;
    synchronizeActiveCombatant(encounter);
    return;
  }
  const eligible = encounter.combatants.flatMap((entry, index) => entry.defeated ? [] : [index]);
  if (!eligible.length) {
    encounter.turn = null;
    synchronizeActiveCombatant(encounter);
    return;
  }
  const current = encounter.turn ?? eligible[0];
  const previous = [...eligible].reverse().find(index => index < current);
  if (previous === undefined && encounter.round > 1) {
    encounter.round -= 1;
    encounter.turn = eligible[eligible.length - 1];
  } else encounter.turn = previous ?? eligible[0];
  synchronizeActiveCombatant(encounter);
}

function firstEligibleCombatant(encounter: Encounter): number | null {
  const index = encounter.combatants.findIndex(entry => !entry.defeated);
  return index >= 0 ? index : null;
}

function tickRoundConditions(scene: Scene): void {
  for (const token of [...scene.tokens, ...scene.players]) {
    if (!token.conditions?.length) continue;
    token.conditions = token.conditions.flatMap(condition => {
      if (condition.remainingRounds === null) return [{ ...condition }];
      const remainingRounds = condition.remainingRounds - 1;
      return remainingRounds > 0 ? [{ ...condition, remainingRounds }] : [];
    });
  }
}

function synchronizeCombatantDefeated(state: PersistedRoomState, token: Token | PlayerToken): void {
  const defeated = token.conditions?.some(condition => condition.id === 'dead') === true;
  for (const encounter of Object.values(state.encounters)) {
    for (const combatant of encounter.combatants) {
      if (combatant.tokenId === token.id) combatant.defeated = defeated;
    }
    synchronizeActiveCombatant(encounter);
  }
}

function synchronizeTokenDefeated(scene: Scene, tokenId: string, defeated: boolean): void {
  const token = findToken(scene, tokenId);
  if (!token) return;
  const conditions = [...(token.conditions ?? [])].filter(condition => condition.id !== 'dead');
  token.conditions = defeated ? [...conditions, { id: 'dead', remainingRounds: null }] : conditions;
}

function normalizeName(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 120);
  return normalized || fallback;
}
