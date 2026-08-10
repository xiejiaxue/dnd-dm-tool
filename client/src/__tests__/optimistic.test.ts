import { describe, expect, it } from 'vitest';
import { applyOptimisticOps } from '../optimistic';
import type { Scene } from '../types';

const scene: Scene = {
  id: 'scene-1',
  name: 'Fast table',
  mapImage: null,
  mapSize: [1200, 800],
  grid: { size: 100, color: '#00000040', offset: [0, 0], snap: true },
  playArea: { x: 0, y: 0, w: 1200, h: 800 },
  tokens: [{ id: 'goblin', kind: 'monster', name: 'Goblin', entryId: 'MM__Goblin', x: 100, y: 100, size: 48, avatar: '', color: '#fff' }],
  players: [{ id: 'hero', kind: 'player', name: 'Hero', entryId: null, x: 200, y: 200, size: 48, avatar: '', color: '#38a169', sessionId: 'viewer' }],
  walls: [],
  initiative: [],
  favorites: [],
  fog: [false, true, false],
};

describe('optimistic room projection', () => {
  it('updates a small player edit without copying unrelated board data', () => {
    const result = applyOptimisticOps({ scene, campaign: null }, [{
      op: 'updatePlayer', tokenId: 'hero', patch: { name: 'Quick Hero' },
    }]);

    expect(result).not.toBeNull();
    expect(result!.scene).not.toBe(scene);
    expect(result!.scene.players).not.toBe(scene.players);
    expect(result!.scene.players[0].name).toBe('Quick Hero');
    expect(result!.scene.tokens).toBe(scene.tokens);
    expect(result!.scene.fog).toBe(scene.fog);
    expect(result!.scene.grid).toBe(scene.grid);
  });

  it('declines commands whose final shape depends on a server-generated ID', () => {
    expect(applyOptimisticOps({ scene, campaign: null }, [{
      op: 'addToInitiative', name: 'Goblin', value: 13, source: 'dm', tokenId: 'goblin',
    }])).toBeNull();
  });
});
