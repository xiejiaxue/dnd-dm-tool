import { Op, Role, Scene, InitiativeEntry, FOG_CELL, fogGridSize } from './types';
import { sortInitiative, advanceInitiative } from './initiative';

export function isPlayerOp(op: Op): boolean {
  return op.op === 'moveToken' || op.op === 'submitInitiative' || op.op === 'updatePlayer';
}

export function canOp(role: Role, op: Op): boolean {
  if (role === 'dm') return true;
  return isPlayerOp(op);
}

export function applyOp(scene: Scene, op: Op): void {
  switch (op.op) {
    case 'addToken': {
      if (!scene.tokens.some(t => t.id === op.token.id)) {
        const token = { ...op.token };
        // Auto-number monster tokens by entryId so same-type monsters are
        // distinguishable on the board (哥布林 1, 哥布林 2, …).
        if (token.kind === 'monster' && token.entryId) {
          const same = scene.tokens.filter(t => t.kind === 'monster' && t.entryId === token.entryId);
          token.number = Math.max(0, ...same.map(t => t.number ?? 0)) + 1;
        }
        scene.tokens.push(token);
      }
      return;
    }
    case 'moveToken': {
      const t = findToken(scene, op.tokenId);
      if (t) { t.x = op.x; t.y = op.y; }
      return;
    }
    case 'removeToken': {
      scene.tokens = scene.tokens.filter(t => t.id !== op.tokenId);
      return;
    }
    case 'updateToken': {
      const t = findToken(scene, op.tokenId);
      if (t) Object.assign(t, op.patch);
      return;
    }
    case 'addPlayer': {
      if (!scene.players.some(p => p.id === op.player.id)) scene.players.push(op.player);
      return;
    }
    case 'removePlayer': {
      scene.players = scene.players.filter(p => p.id !== op.tokenId);
      return;
    }
    case 'updatePlayer': {
      const p = scene.players.find(p => p.id === op.tokenId);
      if (p) Object.assign(p, op.patch);
      return;
    }
    case 'addWall': {
      if (!scene.walls.some(w => w.id === op.wall.id)) scene.walls.push(op.wall);
      return;
    }
    case 'removeWall': {
      scene.walls = scene.walls.filter(w => w.id !== op.wallId);
      return;
    }
    case 'updateGrid': {
      Object.assign(scene.grid, op.patch);
      return;
    }
    case 'updateMap': {
      scene.mapImage = op.mapImage;
      scene.mapSize = op.mapSize;
      scene.playArea = op.playArea;
      scene.mapScale = 1; // a new map starts at natural scale for fresh calibration
      scene.fog = undefined; // 换图后旧 fog 按新 playArea 错位，重置以便按新尺寸重建
      return;
    }
    case 'updateMapScale': {
      scene.mapScale = op.mapScale;
      return;
    }
    case 'submitInitiative': {
      const existing = op.sessionId != null
        ? scene.initiative.find(e => e.sessionId === op.sessionId)
        : scene.initiative.find(e => e.source === 'player' && e.name === op.name);
      if (existing) {
        existing.name = op.name;
        existing.value = op.value;
        existing.tokenId = op.tokenId ?? existing.tokenId;
      } else {
        scene.initiative.push({
          id: genEntryId(scene),
          name: op.name,
          value: op.value,
          source: 'player',
          sessionId: op.sessionId ?? null,
          tokenId: op.tokenId ?? null,
          active: false,
        });
      }
      scene.initiative = sortInitiative(scene.initiative);
      return;
    }
    case 'addToInitiative': {
      scene.initiative.push({
        id: genEntryId(scene),
        name: op.name,
        value: op.value,
        source: op.source,
        sessionId: null,
        tokenId: op.tokenId,
        active: false,
      });
      scene.initiative = sortInitiative(scene.initiative);
      return;
    }
    case 'removeFromInitiative': {
      scene.initiative = scene.initiative.filter(e => e.id !== op.entryId);
      return;
    }
    case 'advanceTurn': {
      scene.initiative = advanceInitiative(scene.initiative);
      return;
    }
    case 'reorderInitiative': {
      const byId = new Map(scene.initiative.map(e => [e.id, e]));
      const ordered: InitiativeEntry[] = [];
      for (const id of op.order) {
        const e = byId.get(id);
        if (e) { ordered.push(e); byId.delete(id); }
      }
      for (const e of byId.values()) ordered.push(e); // 未被列出的追加尾部
      scene.initiative = ordered;
      return;
    }
    case 'addFavorite': {
      if (!scene.favorites.some(f => f.type === op.favorite.type && f.entryId === op.favorite.entryId)) {
        scene.favorites.push(op.favorite);
      }
      return;
    }
    case 'removeFavorite': {
      scene.favorites = scene.favorites.filter(f => !(f.type === op.type && f.entryId === op.entryId));
      return;
    }
    case 'setFog': {
      const fog = ensureFog(scene);
      for (const c of op.cells) {
        // Guard non-integer indices (e.g. NaN from a malformed client) so a bad
        // cell can never silently write a bogus fog slot.
        if (Number.isInteger(c) && c >= 0 && c < fog.length) fog[c] = op.revealed;
      }
      return;
    }
    case 'revealAllFog': {
      ensureFog(scene).fill(true);
      return;
    }
    case 'coverAllFog': {
      ensureFog(scene).fill(false);
      return;
    }
  }
}

function ensureFog(scene: Scene): boolean[] {
  // Grid spans the whole rendered map (mapSize * mapScale), or playArea without
  // a map. Rebuild when the extent changed (map upload / mapScale calibration)
  // so the stored array always matches the current fog grid.
  const { cols, rows } = fogGridSize(scene);
  const len = cols * rows;
  if (!scene.fog || scene.fog.length !== len) {
    scene.fog = new Array(len).fill(false);
  }
  return scene.fog;
}

function findToken(scene: Scene, tokenId: string) {
  return scene.tokens.find(t => t.id === tokenId) ?? scene.players.find(t => t.id === tokenId);
}

let n = 0;
function genEntryId(scene: Scene): string {
  n += 1;
  return `ini-${Date.now().toString(36)}-${n}`;
}
