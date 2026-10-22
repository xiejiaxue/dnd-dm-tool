import { fogGridSize, type Campaign, type NpcRecord, type Op, type PlayerToken, type Scene, type Token } from './types';
import { addFogReveal, fogExtent } from '../../shared/fog-rects';

/** The active-room projection that may be predicted locally. */
export interface OptimisticSnapshot {
  scene: Scene;
  campaign: Campaign | null;
}

/**
 * Apply already-known operations without mutating the server projection.  The
 * reducer uses structural sharing: changing a name or map scale does not copy
 * a potentially large fog array, token list, or map layer unnecessarily.
 * Commands with server-created IDs intentionally return null and wait for the
 * authoritative snapshot instead.
 */
export function applyOptimisticOps(snapshot: OptimisticSnapshot, operations: readonly Op[]): OptimisticSnapshot | null {
  let scene = snapshot.scene;
  let campaign = snapshot.campaign;
  for (const operation of operations) {
    const next = applyOperation(scene, campaign, operation);
    if (!next) return null;
    scene = next.scene;
    campaign = next.campaign;
  }
  return scene === snapshot.scene && campaign === snapshot.campaign ? snapshot : { scene, campaign };
}

function applyOperation(scene: Scene, campaign: Campaign | null, operation: Op): OptimisticSnapshot | null {
  switch (operation.op) {
    case 'moveToken': {
      const tokenIndex = scene.tokens.findIndex((token) => token.id === operation.tokenId);
      if (tokenIndex >= 0) {
        const token = scene.tokens[tokenIndex];
        if (token.x === operation.x && token.y === operation.y) return { scene, campaign };
        return { scene: { ...scene, tokens: replaceAt(scene.tokens, tokenIndex, { ...token, x: operation.x, y: operation.y }) }, campaign };
      }
      const playerIndex = scene.players.findIndex((player) => player.id === operation.tokenId);
      if (playerIndex < 0) return { scene, campaign };
      const player = scene.players[playerIndex];
      if (player.x === operation.x && player.y === operation.y) return { scene, campaign };
      return { scene: { ...scene, players: replaceAt(scene.players, playerIndex, { ...player, x: operation.x, y: operation.y }) }, campaign };
    }
    case 'addToken':
      return scene.tokens.some((token) => token.id === operation.token.id)
        ? { scene, campaign }
        : { scene: { ...scene, tokens: [...scene.tokens, cloneToken(operation.token)] }, campaign };
    case 'removeToken':
      return {
        scene: {
          ...scene,
          tokens: scene.tokens.filter((token) => token.id !== operation.tokenId),
        },
        campaign,
      };
    case 'updateToken': {
      const index = scene.tokens.findIndex((token) => token.id === operation.tokenId);
      if (index < 0) return { scene, campaign };
      const token = scene.tokens[index];
      const { hp, conditions, ...patch } = operation.patch;
      const updated: Token = {
        ...token,
        ...patch,
      };
      if (hp === null) delete updated.hp;
      else if (hp) updated.hp = { ...hp };
      if (conditions) updated.conditions = conditions.map(condition => ({ ...condition }));
      return { scene: { ...scene, tokens: replaceAt(scene.tokens, index, updated) }, campaign };
    }
    case 'addPlayer':
      return scene.players.some((player) => player.id === operation.player.id)
        ? { scene, campaign }
        : { scene: { ...scene, players: [...scene.players, clonePlayer(operation.player)] }, campaign };
    case 'removePlayer':
      return { scene: { ...scene, players: scene.players.filter((player) => player.id !== operation.tokenId) }, campaign };
    case 'updatePlayer': {
      const index = scene.players.findIndex((player) => player.id === operation.tokenId);
      if (index < 0) return { scene, campaign };
      const player = scene.players[index];
      const { hp, conditions, ...patch } = operation.patch;
      const updated: PlayerToken = {
        ...player,
        ...patch,
      };
      if (hp === null) delete updated.hp;
      else if (hp) updated.hp = { ...hp };
      if (conditions) updated.conditions = conditions.map(condition => ({ ...condition }));
      return { scene: { ...scene, players: replaceAt(scene.players, index, updated) }, campaign };
    }
    case 'addWall':
      return scene.walls.some((wall) => wall.id === operation.wall.id)
        ? { scene, campaign }
        : { scene: { ...scene, walls: [...scene.walls, { ...operation.wall, p1: [...operation.wall.p1] as [number, number], p2: [...operation.wall.p2] as [number, number] }] }, campaign };
    case 'removeWall':
      return { scene: { ...scene, walls: scene.walls.filter((wall) => wall.id !== operation.wallId) }, campaign };
    case 'updateWall': {
      const index = scene.walls.findIndex((wall) => wall.id === operation.wallId);
      if (index < 0) return { scene, campaign };
      const wall = scene.walls[index];
      return { scene: { ...scene, walls: replaceAt(scene.walls, index, {
        ...wall,
        ...operation.patch,
        ...(operation.patch.p1 ? { p1: [...operation.patch.p1] as [number, number] } : {}),
        ...(operation.patch.p2 ? { p2: [...operation.patch.p2] as [number, number] } : {}),
      }) }, campaign };
    }
    case 'updateGrid':
      return { scene: { ...scene, grid: { ...scene.grid, ...operation.patch, ...(operation.patch.offset ? { offset: [...operation.patch.offset] as [number, number] } : {}) } }, campaign };
    case 'updateMap':
      return {
        scene: {
          ...scene,
          mapImage: operation.mapImage,
          mapSize: [...operation.mapSize] as [number, number],
          playArea: { ...operation.playArea },
          mapScale: 1,
          fog: undefined,
          fogReveals: [],
          fogVersion: 2,
        },
        campaign,
      };
    case 'updateMapScale':
      return {
        scene: scene.mapScale === operation.mapScale ? scene : { ...scene, mapScale: operation.mapScale },
        campaign,
      };
    case 'addEnemy':
      if (!campaign) return null;
      return campaign.enemies.some((entry) => entry.entryId === operation.entryId)
        ? { scene, campaign }
        : { scene, campaign: { ...campaign, enemies: [...campaign.enemies, { entryId: operation.entryId, nameZh: operation.nameZh }] } };
    case 'removeEnemy':
      if (!campaign) return null;
      return { scene, campaign: { ...campaign, enemies: campaign.enemies.filter((entry) => entry.entryId !== operation.entryId) } };
    case 'upsertNpc': {
      if (!campaign) return null;
      const npcs = campaign.npcs ?? [];
      const index = npcs.findIndex((npc) => npc.id === operation.npc.id);
      const nextNpcs = index >= 0
        ? replaceAt(npcs, index, cloneNpc(operation.npc))
        : [...npcs, cloneNpc(operation.npc)];
      return { scene, campaign: { ...campaign, npcs: nextNpcs } };
    }
    case 'removeNpc':
      if (!campaign) return null;
      return { scene, campaign: { ...campaign, npcs: (campaign.npcs ?? []).filter((npc) => npc.id !== operation.npcId) } };
    case 'switchCampaign':
    case 'submitInitiative':
    case 'addToInitiative':
    case 'removeFromInitiative':
    case 'setCombatantHidden':
    case 'updateCombatant':
    case 'createEncounter':
    case 'duplicateEncounter':
    case 'startEncounter':
    case 'endEncounter':
    case 'previousTurn':
    case 'nextTurn':
    case 'previousRound':
    case 'nextRound':
    case 'endMyTurn':
    case 'advanceTurn':
    case 'reorderInitiative':
      return null;
    case 'addFavorite':
      return scene.favorites.some((item) => item.type === operation.favorite.type && item.entryId === operation.favorite.entryId)
        ? { scene, campaign }
        : { scene: { ...scene, favorites: [...scene.favorites, { ...operation.favorite }] }, campaign };
    case 'removeFavorite':
      return { scene: { ...scene, favorites: scene.favorites.filter((item) => item.type !== operation.type || item.entryId !== operation.entryId) }, campaign };
    case 'setFog': {
      const fog = editableFog(scene);
      let changed = false;
      for (const cell of operation.cells) {
        if (cell >= 0 && cell < fog.length && fog[cell] !== operation.revealed) {
          fog[cell] = operation.revealed;
          changed = true;
        }
      }
      return changed || !scene.fog ? { scene: { ...scene, fog }, campaign } : { scene, campaign };
    }
    case 'revealFogRect':
      return { scene: { ...scene, fogReveals: addFogReveal(scene.fogReveals ?? [], operation.rect) }, campaign };
    case 'revealAllFog': {
      const { width, height } = fogExtent(scene);
      return { scene: { ...scene, fog: undefined, fogReveals: [{ x: 0, y: 0, w: width, h: height }] }, campaign };
    }
    case 'coverAllFog':
      return { scene: { ...scene, fog: undefined, fogReveals: [] }, campaign };
    case 'restoreFog':
      return {
        scene: {
          ...scene,
          fog: operation.fog ? [...operation.fog] : undefined,
          fogReveals: operation.fogReveals.map((rect) => ({ ...rect })),
          fogVersion: 2,
        },
        campaign,
      };
  }
}

function cloneNpc(npc: NpcRecord): NpcRecord {
  return {
    ...npc,
    aliases: [...npc.aliases],
    ...(npc.groupPath ? { groupPath: [...npc.groupPath] } : {}),
    ...(npc.statReference ? { statReference: { ...npc.statReference } } : {}),
  };
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return [...items.slice(0, index), value, ...items.slice(index + 1)];
}

function cloneToken(token: Token): Token {
  return {
    ...token,
    ...(token.hp ? { hp: { ...token.hp } } : {}),
    ...(token.conditions ? { conditions: token.conditions.map(condition => ({ ...condition })) } : {}),
  };
}

function clonePlayer(player: PlayerToken): PlayerToken {
  return { ...cloneToken(player), sessionId: player.sessionId };
}

function editableFog(scene: Scene): boolean[] {
  const { cols, rows } = fogGridSize(scene);
  const length = cols * rows;
  return scene.fog && scene.fog.length === length ? [...scene.fog] : new Array<boolean>(length).fill(false);
}
