import { waterdeepHp } from '../../waterdeep';
import { connection } from '../../ws';
import type { Scene } from '../../types';

// Directly add a monster token to the scene, tiled in a grid around the
// play-area centre so repeated adds don't stack exactly on top of each other.
export const spawnEnemy = (scene: Scene | null, entryId: string, nameZh: string) => {
  if (!scene) return;
  const area = scene.mapImage
    ? { x: 0, y: 0, w: scene.mapSize[0] * (scene.mapScale ?? 1), h: scene.mapSize[1] * (scene.mapScale ?? 1) }
    : scene.playArea;
  const spacing = Math.min(100, area.w / 4, area.h / 4);
  const i = scene.tokens.filter(t => t.entryId === entryId).length;
  const x = area.x + Math.max(0, Math.min(area.w, area.w / 2 + (i % 4 - 1) * spacing));
  const y = area.y + Math.max(0, Math.min(area.h, area.h / 2 + (Math.floor(i / 4) - 1) * spacing));
  connection.sendOps([{
    op: 'addToken',
    token: {
      id: `t${Date.now()}-${i}`,
      kind: 'monster',
      hidden: true,
      name: nameZh,
      entryId,
      x, y, size: 100,
      avatar: `/api/token/${encodeURIComponent(entryId)}`,
      color: '#fff',
          hp: waterdeepHp(entryId),
    },
  }]);
};


/** Board label for an encounter row: "威利福特·克维洛（变形怪）" → "威利福特·克维洛". */
export const tokenName = (name: string) => name.replace(/[（(].*$/, '').trim() || name;

/**
 * Place a whole encounter as hidden tokens in one go, laid out in rows around
 * the play-area centre. Rows without a stat card are skipped.
 */
export const placeEncounter = (scene: Scene | null, enemies: readonly { name: string; count: number; entryId?: string }[]): number => {
  if (!scene) return 0;
  const area = scene.mapImage
    ? { x: 0, y: 0, w: scene.mapSize[0] * (scene.mapScale ?? 1), h: scene.mapSize[1] * (scene.mapScale ?? 1) }
    : scene.playArea;
  const spacing = Math.min(100, area.w / 8, area.h / 8);
  const units = enemies.flatMap(enemy => enemy.entryId ? Array.from({ length: enemy.count }, () => ({ name: tokenName(enemy.name), entryId: enemy.entryId! })) : []);
  const perRow = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(units.length))));
  const rows = Math.ceil(units.length / perRow);
  const stamp = Date.now();
  const ops = units.map((unit, i) => ({
    op: 'addToken' as const,
    token: {
      id: `t${stamp}-${i}`,
      kind: 'monster' as const,
      hidden: true,
      name: unit.name,
      entryId: unit.entryId,
      x: Math.max(area.x, Math.min(area.x + area.w, area.x + area.w / 2 + ((i % perRow) - (perRow - 1) / 2) * spacing)),
      y: Math.max(area.y, Math.min(area.y + area.h, area.y + area.h / 2 + (Math.floor(i / perRow) - (rows - 1) / 2) * spacing)),
      size: 100,
      avatar: `/api/token/${encodeURIComponent(unit.entryId)}`,
      color: '#fff',
      hp: waterdeepHp(unit.entryId),
    },
  }));
  // The room protocol accepts at most 20 operations per command.
  for (let i = 0; i < ops.length; i += 20) connection.sendOps(ops.slice(i, i + 20));
  return ops.length;
};
