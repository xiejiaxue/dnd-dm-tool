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

