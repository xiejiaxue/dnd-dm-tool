import { describe, expect, it } from 'vitest';
import { invertBoardOperations } from '../features/history/invertBoardOperations';
import type { Encounter, Scene } from '../types';

const scene: Scene = {
  id: 'scene-1', name: 'Scene', mapImage: null, mapSize: [1000, 800], mapScale: 1,
  grid: { size: 50, color: '#fff', offset: [0, 0], snap: true },
  playArea: { x: 0, y: 0, w: 1000, h: 800 }, fogReveals: [{ x: 1, y: 2, w: 3, h: 4 }],
  tokens: [
    { id: 'token-1', kind: 'monster', name: 'Goblin', entryId: null, avatar: '', x: 100, y: 120, size: 48, color: '#f00', hp: { current: 5, max: 7 } },
    { id: 'token-2', kind: 'npc', name: 'Guide', entryId: null, avatar: '', x: 200, y: 220, size: 48, color: '#0af' },
  ],
  players: [{ id: 'player-1', kind: 'player', name: 'Hero', entryId: null, x: 300, y: 320, size: 48, avatar: '', color: '#fff', sessionId: 'user-1' }],
  walls: [{ id: 'wall-1', p1: [10, 20], p2: [30, 40] }], initiative: [], favorites: [],
};

describe('board command inversion', () => {
  it('restores a moved wall and a changed token', () => {
    expect(invertBoardOperations(scene, null, [
      { op: 'updateWall', wallId: 'wall-1', patch: { p1: [100, 200], p2: [300, 400] } },
      { op: 'updateToken', tokenId: 'token-1', patch: { hp: { current: 1, max: 7 } } },
    ])).toEqual([
      { op: 'updateToken', tokenId: 'token-1', patch: { hp: { current: 5, max: 7 } } },
      { op: 'updateWall', wallId: 'wall-1', patch: { p1: [10, 20], p2: [30, 40] } },
    ]);
  });

  it('snapshots fog before a destructive fog command', () => {
    expect(invertBoardOperations(scene, null, [{ op: 'coverAllFog' }])).toEqual([
      { op: 'restoreFog', fog: null, fogReveals: [{ x: 1, y: 2, w: 3, h: 4 }] },
    ]);
  });

  it('can remove HP that did not exist before the command', () => {
    expect(invertBoardOperations(scene, null, [{
      op: 'updateToken', tokenId: 'token-2', patch: { hp: { current: 10, max: 10 } },
    }])).toEqual([{ op: 'updateToken', tokenId: 'token-2', patch: { hp: null } }]);
  });

  it('restores initiative membership only when undoing token deletion', () => {
    const encounter: Encounter = {
      id: 'enc-1', sceneId: 'scene-1', name: 'Combat', status: 'active', round: 1, turn: 0, createdAt: 1, endedAt: null,
      combatants: [{ id: 'c-1', name: 'Goblin', value: 12, source: 'dm', tokenId: 'token-1', sessionId: null, active: true }],
    };
    const inverse = invertBoardOperations(scene, encounter, [{ op: 'removeToken', tokenId: 'token-1' }]);
    expect(inverse?.[0]).toMatchObject({ op: 'addToken', token: { id: 'token-1' } });
    expect(inverse?.[1]).toMatchObject({ op: 'addToInitiative', tokenId: 'token-1', value: 12 });
  });

  it('restores player initiative membership when undoing player deletion', () => {
    const encounter: Encounter = {
      id: 'enc-2', sceneId: 'scene-1', name: 'Combat', status: 'active', round: 1, turn: 0, createdAt: 1, endedAt: null,
      combatants: [{ id: 'c-2', name: 'Hero', value: 15, source: 'player', tokenId: 'player-1', sessionId: 'user-1', active: true }],
    };
    const inverse = invertBoardOperations(scene, encounter, [{ op: 'removePlayer', tokenId: 'player-1' }]);
    expect(inverse?.[0]).toMatchObject({ op: 'addPlayer', player: { id: 'player-1' } });
    expect(inverse?.[1]).toMatchObject({ op: 'addToInitiative', tokenId: 'player-1', value: 15 });
  });
});
