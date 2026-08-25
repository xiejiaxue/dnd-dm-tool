import { describe, expect, it } from 'vitest';
import { createMonsterToken } from '../features/compendium/monsterToken';
import type { Scene } from '../types';

const scene: Scene = {
  id: 'scene-1', name: 'Scene', mapImage: null, mapSize: [1600, 1200],
  grid: { size: 100, color: '#fff', offset: [0, 0], snap: true },
  playArea: { x: 0, y: 0, w: 1600, h: 1200 },
  tokens: [], players: [], walls: [], initiative: [], favorites: [],
};

describe('compendium monster token factory', () => {
  it('builds the shared-size avatar token with initial hit points', () => {
    expect(createMonsterToken(scene, {
      id: 'MM__Goblin',
      nameZh: '地精',
      hitPoints: 7,
    }, 'token-1')).toEqual({
      id: 'token-1',
      kind: 'monster',
      name: '地精',
      entryId: 'MM__Goblin',
      x: 100,
      y: 100,
      size: 100,
      avatar: '/api/token/MM__Goblin',
      color: '#fff',
      hp: { current: 7, max: 7 },
    });
  });
});
