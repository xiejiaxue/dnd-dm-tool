import { initialHitPoints } from '../hit-points/model';
import { nextTokenSpawn } from '../../tokenPlacement';
import { DEFAULT_TOKEN_SIZE, type IndexEntry, type Scene, type Token } from '../../types';

export type MonsterSearchEntry = Pick<IndexEntry, 'id' | 'nameZh' | 'hitPoints'>;

/** Build the canonical token payload used by one-click compendium additions. */
export function createMonsterToken(scene: Scene, monster: MonsterSearchEntry, id: string): Token {
  const { x, y } = nextTokenSpawn(scene);
  const hp = initialHitPoints(monster.hitPoints);
  return {
    id,
    kind: 'monster',
    name: monster.nameZh,
    entryId: monster.id,
    x,
    y,
    size: DEFAULT_TOKEN_SIZE,
    avatar: `/api/token/${monster.id}`,
    color: '#fff',
    ...(hp ? { hp } : {}),
  };
}
