import { describe, it, expect } from 'vitest';
import { applyOp, canOp, isPlayerOp } from './ops';
import { createScene } from './scene';
import { Scene, Op } from './types';

function freshScene(): Scene {
  return JSON.parse(JSON.stringify(createScene('t')));
}

describe('canOp', () => {
  it('dm can do everything', () => {
    const ops: Op[] = [
      { op: 'moveToken', tokenId: 'a', x: 0, y: 0 },
      { op: 'addToken', token: {} as never },
      { op: 'advanceTurn' },
      { op: 'reorderInitiative', order: [] },
    ];
    for (const op of ops) expect(canOp('dm', op)).toBe(true);
  });

  it('player can only moveToken and submitInitiative', () => {
    expect(canOp('player', { op: 'moveToken', tokenId: 'a', x: 0, y: 0 })).toBe(true);
    expect(canOp('player', { op: 'submitInitiative', name: 'x', value: 5, tokenId: null })).toBe(true);
    expect(canOp('player', { op: 'addToken', token: {} as never })).toBe(false);
    expect(canOp('player', { op: 'advanceTurn' })).toBe(false);
  });
});

describe('applyOp token ops', () => {
  it('adds and moves and removes tokens', () => {
    const s = freshScene();
    applyOp(s, { op: 'addToken', token: { id: 't1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '/api/token/MM__Goblin', color: '#fff' } });
    expect(s.tokens).toHaveLength(1);
    applyOp(s, { op: 'moveToken', tokenId: 't1', x: 300, y: 400 });
    expect(s.tokens[0].x).toBe(300);
    applyOp(s, { op: 'updateToken', tokenId: 't1', patch: { name: '哥布林' } });
    expect(s.tokens[0].name).toBe('哥布林');
    applyOp(s, { op: 'removeToken', tokenId: 't1' });
    expect(s.tokens).toHaveLength(0);
  });

  it('updateToken on missing token is a no-op', () => {
    const s = freshScene();
    applyOp(s, { op: 'moveToken', tokenId: 'nope', x: 1, y: 2 });
    expect(s.tokens).toHaveLength(0);
  });

  it('auto-numbers monster tokens per entryId', () => {
    const s = freshScene();
    const mk = (id: string, entryId: string) => ({ id, kind: 'monster' as const, name: '地精', entryId, x: 0, y: 0, size: 100, avatar: '/api/token/x', color: '#fff' });
    applyOp(s, { op: 'addToken', token: mk('a', 'MM__Goblin') });
    applyOp(s, { op: 'addToken', token: mk('b', 'MM__Goblin') });
    applyOp(s, { op: 'addToken', token: mk('c', 'MM__Hobgoblin') });
    const goblins = s.tokens.filter(t => t.entryId === 'MM__Goblin');
    expect(goblins.map(t => t.number)).toEqual([1, 2]);
    expect(s.tokens.find(t => t.id === 'c')!.number).toBe(1);
  });

  it('player tokens get no number', () => {
    const s = freshScene();
    applyOp(s, { op: 'addPlayer', player: { id: 'p1', kind: 'player', name: '阿拉贡', entryId: null, x: 0, y: 0, size: 100, avatar: '', color: '#e53e3e', sessionId: null } });
    expect(s.players[0].number).toBeUndefined();
  });
});

describe('applyOp players', () => {
  it('adds and updates players', () => {
    const s = freshScene();
    applyOp(s, { op: 'addPlayer', player: { id: 'p1', kind: 'player', name: '阿拉贡', entryId: null, x: 100, y: 100, size: 100, avatar: '', color: '#e53e3e', sessionId: null } });
    expect(s.players).toHaveLength(1);
    applyOp(s, { op: 'updatePlayer', tokenId: 'p1', patch: { sessionId: 'sess-1' } });
    expect(s.players[0].sessionId).toBe('sess-1');
  });
});

describe('applyOp walls & grid & map', () => {
  it('walls', () => {
    const s = freshScene();
    applyOp(s, { op: 'addWall', wall: { id: 'w1', p1: [0, 0], p2: [100, 100] } });
    expect(s.walls).toHaveLength(1);
    applyOp(s, { op: 'removeWall', wallId: 'w1' });
    expect(s.walls).toHaveLength(0);
  });

  it('grid patch merges', () => {
    const s = freshScene();
    applyOp(s, { op: 'updateGrid', patch: { size: 50 } });
    expect(s.grid.size).toBe(50);
    expect(s.grid.snap).toBe(true);
  });

  it('map update', () => {
    const s = freshScene();
    applyOp(s, { op: 'updateMap', mapImage: 'uploads/m.jpg', mapSize: [800, 600], playArea: { x: 0, y: 0, w: 800, h: 600 } });
    expect(s.mapImage).toBe('uploads/m.jpg');
    expect(s.mapSize).toEqual([800, 600]);
  });
});

describe('applyOp initiative', () => {
  it('submitInitiative adds then upserts by sessionId, sorts desc', () => {
    const s = freshScene();
    applyOp(s, { op: 'submitInitiative', name: '甲', value: 10, tokenId: null });
    applyOp(s, { op: 'submitInitiative', name: '乙', value: 20, tokenId: null });
    applyOp(s, { op: 'submitInitiative', name: '丙', value: 15, tokenId: null });
    expect(s.initiative).toHaveLength(3);
    expect(s.initiative.map(e => e.value)).toEqual([20, 15, 10]);
    const id = s.initiative.find(e => e.name === '乙')!.id;
    // 重提交（无 sessionId 时按名字 upsert）
    applyOp(s, { op: 'submitInitiative', name: '乙', value: 5, tokenId: null });
    expect(s.initiative).toHaveLength(3);
    expect(s.initiative.map(e => e.value)).toEqual([15, 10, 5]);
    expect(id).toBeDefined();
  });

  it('addToInitiative, removeFromInitiative, reorder, advanceTurn', () => {
    const s = freshScene();
    applyOp(s, { op: 'addToInitiative', name: 'A', value: 30, source: 'dm', tokenId: 't1' });
    applyOp(s, { op: 'addToInitiative', name: 'B', value: 20, source: 'dm', tokenId: null });
    expect(s.initiative.map(e => e.value)).toEqual([30, 20]);
    const firstId = s.initiative[0].id;
    applyOp(s, { op: 'advanceTurn' });
    expect(s.initiative.find(e => e.active)).toBe(s.initiative[0]);
    applyOp(s, { op: 'advanceTurn' });
    expect(s.initiative.find(e => e.active)).toBe(s.initiative[1]);
    applyOp(s, { op: 'advanceTurn' });
    expect(s.initiative.find(e => e.active)).toBe(s.initiative[0]); // 回绕
    applyOp(s, { op: 'reorderInitiative', order: [s.initiative[1].id, s.initiative[0].id] });
    expect(s.initiative.map(e => e.value)).toEqual([20, 30]);
    applyOp(s, { op: 'removeFromInitiative', entryId: s.initiative[1].id });
    expect(s.initiative).toHaveLength(1);
  });
});

describe('applyOp favorites', () => {
  it('add and remove favorite', () => {
    const s = freshScene();
    applyOp(s, { op: 'addFavorite', favorite: { type: 'monster', entryId: 'MM__Goblin' } });
    expect(s.favorites).toHaveLength(1);
    applyOp(s, { op: 'addFavorite', favorite: { type: 'monster', entryId: 'MM__Goblin' } });
    expect(s.favorites).toHaveLength(1); // 去重
    applyOp(s, { op: 'removeFavorite', type: 'monster', entryId: 'MM__Goblin' });
    expect(s.favorites).toHaveLength(0);
  });
});
