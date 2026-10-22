import { connection } from '../../ws';
import type { Scene } from '../../types';

// Directly add a monster token to the scene, tiled in a grid around the
// play-area centre so repeated adds don't stack exactly on top of each other.
export const spawnEnemy = (scene: Scene | null, entryId: string, nameZh: string) => {
  if (!scene) return;
  const area = scene.playArea;
  const i = scene.tokens.filter(t => t.entryId === entryId).length;
  const x = area.x + area.w / 2 + (i % 4 - 1) * 100;
  const y = area.y + area.h / 2 + (Math.floor(i / 4) - 1) * 100;
  connection.sendOps([{
    op: 'addToken',
    token: {
      id: `t${Date.now()}-${i}`,
      kind: 'monster',
      name: nameZh,
      entryId,
      x, y, size: 100,
      avatar: `/api/token/${entryId}`,
      color: '#fff',
    },
  }]);
};

