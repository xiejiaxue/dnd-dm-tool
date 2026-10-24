import { resolveFogBasisScale, revealFogRectangle, coverFogRectangles } from '../../shared/fog';
import { removeFromTurnOrder, stepTurn } from '../../shared/initiative';
import { fogGridSize, type Campaign, type InitiativeEntry, type Op, type PlayerToken, type Scene, type Token } from './types';

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
      return { scene: { ...scene, ...removeFromTurnOrder(scene, entry => entry.tokenId === operation.tokenId), tokens: scene.tokens.filter((token) => token.id !== operation.tokenId) }, campaign };
    case 'updateToken': {
      const index = scene.tokens.findIndex((token) => token.id === operation.tokenId);
      if (index < 0) return { scene, campaign };
      const token = scene.tokens[index];
      return { scene: { ...scene, tokens: replaceAt(scene.tokens, index, { ...token, ...operation.patch, ...(operation.patch.hp ? { hp: { ...operation.patch.hp } } : {}) }) }, campaign };
    }
    case 'addPlayer':
      return scene.players.some((player) => player.id === operation.player.id)
        ? { scene, campaign }
        : { scene: { ...scene, players: [...scene.players, clonePlayer(operation.player)] }, campaign };
    case 'removePlayer':
      return { scene: { ...scene, players: scene.players.filter((player) => player.id !== operation.tokenId), ...removeFromTurnOrder(scene, (entry) => entry.tokenId === operation.tokenId) }, campaign };
    case 'updatePlayer': {
      const index = scene.players.findIndex((player) => player.id === operation.tokenId);
      if (index < 0) return { scene, campaign };
      const player = scene.players[index];
      return { scene: { ...scene, players: replaceAt(scene.players, index, { ...player, ...operation.patch, ...(operation.patch.hp ? { hp: { ...operation.patch.hp } } : {}) }) }, campaign };
    }
    case 'addWall':
      return scene.walls.some((wall) => wall.id === operation.wall.id)
        ? { scene, campaign }
        : { scene: { ...scene, walls: [...scene.walls, { ...operation.wall, p1: [...operation.wall.p1] as [number, number], p2: [...operation.wall.p2] as [number, number] }] }, campaign };
    case 'removeWall':
      return { scene: { ...scene, walls: scene.walls.filter((wall) => wall.id !== operation.wallId) }, campaign };
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
          fogBasisScale: operation.fogBasisScale ?? 1,
          fog: undefined,
          fogReveals: undefined,
        },
        campaign,
      };
    case 'updateMapScale':
      return { scene: scene.mapScale === operation.mapScale && scene.fogBasisScale !== undefined ? scene : { ...scene, mapScale: operation.mapScale, fogBasisScale: operation.fogBasisScale ?? resolveFogBasisScale(scene) }, campaign };
    case 'addEnemy':
      if (!campaign) return null;
      return campaign.enemies.some((entry) => entry.entryId === operation.entryId)
        ? { scene, campaign }
        : { scene, campaign: { ...campaign, enemies: [...campaign.enemies, { entryId: operation.entryId, nameZh: operation.nameZh }] } };
    case 'removeEnemy':
      if (!campaign) return null;
      return { scene, campaign: { ...campaign, enemies: campaign.enemies.filter((entry) => entry.entryId !== operation.entryId) } };
    case 'switchCampaign':
    case 'submitInitiative':
    case 'addToInitiative':
      return null;
    case 'removeFromInitiative':
      return { scene: { ...scene, ...removeFromTurnOrder(scene, (entry) => entry.id === operation.entryId) }, campaign };
    case 'advanceTurn':
    case 'previousTurn':
      return { scene: { ...scene, ...stepTurn(scene, operation.op === 'advanceTurn' ? 1 : -1) }, campaign };
    case 'reorderInitiative':
      return { scene: { ...scene, initiative: reorderInitiative(scene.initiative, operation.order) }, campaign };
    case 'addFavorite':
      return scene.favorites.some((item) => item.type === operation.favorite.type && item.entryId === operation.favorite.entryId)
        ? { scene, campaign }
        : { scene: { ...scene, favorites: [...scene.favorites, { ...operation.favorite }] }, campaign };
    case 'removeFavorite':
      return { scene: { ...scene, favorites: scene.favorites.filter((item) => item.type !== operation.type || item.entryId !== operation.entryId) }, campaign };
    case 'revealFogRect':
      return { scene: { ...scene, fogReveals: revealFogRectangle(scene, operation.rect) }, campaign };
    case 'setFog': {
      if (operation.basisScale !== undefined && Math.abs(operation.basisScale - resolveFogBasisScale(scene)) > 0.000001) return null;
      const fog = editableFog(scene);
      const fogReveals = operation.revealed ? scene.fogReveals : coverFogRectangles(scene, operation.cells);
      let changed = fogReveals !== scene.fogReveals;
      for (const cell of operation.cells) {
        if (cell >= 0 && cell < fog.length && fog[cell] !== operation.revealed) {
          fog[cell] = operation.revealed;
          changed = true;
        }
      }
      return changed || !scene.fog || scene.fogBasisScale === undefined || scene.fog.length !== fog.length ? { scene: { ...scene, fog, fogReveals, fogBasisScale: resolveFogBasisScale(scene) }, campaign } : { scene, campaign };
    }
    case 'revealAllFog': {
      const fog = editableFog(scene);
      if (!scene.fogReveals && scene.fog && scene.fogBasisScale !== undefined && scene.fog.length === fog.length && fog.every(Boolean)) return { scene, campaign };
      fog.fill(true);
      return { scene: { ...scene, fog, fogReveals: undefined, fogBasisScale: resolveFogBasisScale(scene) }, campaign };
    }
    case 'coverAllFog': {
      const fog = editableFog(scene);
      if (!scene.fogReveals && scene.fog && scene.fogBasisScale !== undefined && scene.fog.length === fog.length && fog.every((cell) => !cell)) return { scene, campaign };
      fog.fill(false);
      return { scene: { ...scene, fog, fogReveals: undefined, fogBasisScale: resolveFogBasisScale(scene) }, campaign };
    }
  }
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return [...items.slice(0, index), value, ...items.slice(index + 1)];
}

function cloneToken(token: Token): Token {
  return { ...token, ...(token.hp ? { hp: { ...token.hp } } : {}) };
}

function clonePlayer(player: PlayerToken): PlayerToken {
  return { ...cloneToken(player), sessionId: player.sessionId };
}

function editableFog(scene: Scene): boolean[] {
  const { cols, rows } = fogGridSize(scene);
  const length = cols * rows;
  return scene.fog && scene.fog.length === length ? [...scene.fog] : new Array<boolean>(length).fill(false);
}

function reorderInitiative(entries: readonly InitiativeEntry[], order: readonly string[]): InitiativeEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ordered: InitiativeEntry[] = [];
  for (const id of order) {
    const entry = byId.get(id);
    if (entry) {
      ordered.push(entry);
      byId.delete(id);
    }
  }
  return [...ordered, ...byId.values()];
}
