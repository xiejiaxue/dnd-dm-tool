import { describe, expect, it } from 'vitest';
import { activeScene, applyOperation, createInitialRoomState, type PersistedRoomState } from '../src/domain';
import { applyUndo, captureUndo, mergeUndo, undoLabel } from '../src/undo';
import type { Op, Token } from '../../shared/types';

const goblin = (id: string, x = 0): Token => ({ id, kind: 'monster', name: id, entryId: null, x, y: 0, size: 100, avatar: '', color: '#000' });

/** Applies ops the way the room does: on a copy whose active scene is cloned. */
function step(state: PersistedRoomState, ops: Op[]): PersistedRoomState {
  const next = { ...state, campaign: structuredClone(state.campaign), scenes: { ...state.scenes, [state.currentSceneId]: structuredClone(activeScene(state)) } };
  for (const op of ops) applyOperation(next, op);
  return next;
}

function undo(state: PersistedRoomState, entry: NonNullable<ReturnType<typeof captureUndo>>): PersistedRoomState {
  const next = { ...state, campaign: structuredClone(state.campaign), scenes: { ...state.scenes, [entry.sceneId]: structuredClone(state.scenes[entry.sceneId]) } };
  applyUndo(next, entry);
  return next;
}

describe('DM undo', () => {
  it('names commands and skips live table controls', () => {
    expect(undoLabel([{ op: 'moveToken', tokenId: 'a', x: 1, y: 1 }])).toBe('移动棋子');
    expect(undoLabel([{ op: 'hideHandout' }])).toBeNull();
    expect(undoLabel([{ op: 'setMusic', music: null }, { op: 'revealAllFog' }])).toBe('修改迷雾');
  });

  it('takes back one token move while a later move of another token survives', () => {
    let state = createInitialRoomState('t', 'c');
    activeScene(state).tokens.push(goblin('a'), goblin('b'));
    const before = state;
    state = step(state, [{ op: 'moveToken', tokenId: 'a', x: 300, y: 0 }]);
    const entry = captureUndo(before, state, '移动棋子', 1)!;
    expect(Object.keys(entry.scene)).toEqual([]);
    expect(Object.keys(entry.items.tokens!)).toEqual(['a']);
    state = step(state, [{ op: 'moveToken', tokenId: 'b', x: 500, y: 0 }]);
    const restored = activeScene(undo(state, entry));
    expect(restored.tokens.map(t => [t.id, t.x])).toEqual([['a', 0], ['b', 500]]);
  });

  it('restores a removed token at its place together with its initiative entry', () => {
    let state = createInitialRoomState('t', 'c');
    const scene = activeScene(state);
    scene.tokens.push(goblin('a'), goblin('b'), goblin('c'));
    scene.initiative.push({ id: 'i-b', name: 'b', value: 12, source: 'dm', sessionId: null, tokenId: 'b', active: true });
    const before = state;
    state = step(state, [{ op: 'removeToken', tokenId: 'b' }]);
    const entry = captureUndo(before, state, '删除棋子', 1)!;
    const restored = activeScene(undo(state, entry));
    expect(restored.tokens.map(t => t.id)).toEqual(['a', 'b', 'c']);
    expect(restored.initiative).toEqual(scene.initiative);
  });

  it('removes an added note and restores fields that were absent before', () => {
    let state = createInitialRoomState('t', 'c');
    const before = state;
    state = step(state, [
      { op: 'addMapNote', note: { id: 'n1', x: 1, y: 2, title: 'x', text: '', visible: false } },
      { op: 'revealAllFog' },
    ]);
    const entry = captureUndo(before, state, '添加地图笔记', 1)!;
    const restored = activeScene(undo(state, entry));
    expect(restored.notes).toEqual([]);
    expect(restored.fog).toBeUndefined();
  });

  it('folds a fog stroke into one entry that keeps the board before the stroke', () => {
    let state = createInitialRoomState('t', 'c');
    const start = state;
    state = step(state, [{ op: 'setFog', cells: [0], revealed: true, basisScale: 1 }]);
    const first = captureUndo(start, state, '修改迷雾', 1_000)!;
    const middle = state;
    state = step(state, [{ op: 'setFog', cells: [1], revealed: true, basisScale: 1 }]);
    const second = captureUndo(middle, state, '修改迷雾', 1_500)!;
    const merged = mergeUndo(first, second)!;
    expect(merged.at).toBe(1_500);
    expect(activeScene(undo(state, merged)).fog).toBeUndefined();
    expect(mergeUndo(first, { ...second, at: 9_000 })).toBeNull();
    expect(mergeUndo(first, { ...second, label: '移动棋子' })).toBeNull();
  });

  it('records campaign changes but never the music or handouts', () => {
    let state = createInitialRoomState('t', 'c');
    const before = state;
    state = step(state, [{ op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' }, { op: 'hideHandout' }]);
    const entry = captureUndo(before, state, '修改遭遇列表', 1)!;
    expect(Object.keys(entry.campaign)).toEqual(['enemies']);
    expect(undo(state, entry).campaign.enemies).toEqual([]);
    const music = step(state, [{ op: 'setMusic', music: { trackId: 't', title: 'T', url: '/music/a.mp3', playing: true, position: 0, updatedAt: 1, loop: true } }]);
    expect(captureUndo(state, music, '配乐', 1)).toBeNull();
  });
});
