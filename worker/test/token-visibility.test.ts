import { expect, it } from 'vitest';
import { activeScene, applyOperation, authorizeOperation, createInitialRoomState, projectRoomState, type RoomActor } from '../src/domain';
import { projectPatchOperations } from '../src/room';
const dm: RoomActor = { userId: 'dm', memberId: 'dm', role: 'host', accessEpoch: 1 };
const player: RoomActor = { ...dm, userId: 'player', role: 'player' };
it('hides new tokens and initiative, reveals and re-hides without losing position or HP, and survives reload', () => {
  let state = createInitialRoomState('test', 'test');
  const add = authorizeOperation({ op: 'addToken', token: { name: '伏兵', entryId: null, x: 50, y: 75, size: 100, avatar: '', color: '#fff', hp: { current: 8, max: 12 } } }, state, dm);
  applyOperation(state, add);
  const token = activeScene(state).tokens[0];
  applyOperation(state, { op: 'addToInitiative', name: token.name, value: 15, source: 'dm', tokenId: token.id });
  expect(projectRoomState(state, player).scene.tokens).toEqual([]);
  expect(projectRoomState(state, player).scene.initiative).toEqual([]);
  expect(projectRoomState(state, dm).scene.tokens[0].hidden).toBe(true);
  expect(projectPatchOperations(state, [add], player)).toBeNull();
  for (const hidden of [false, true]) {
    const op = authorizeOperation({ op: 'updateToken', tokenId: token.id, patch: { hidden } }, state, dm);
    applyOperation(state, op);
    state = JSON.parse(JSON.stringify(state));
    expect(projectPatchOperations(state, [op], player)).toBeNull();
    const view = projectRoomState(state, player).scene;
    expect(view.tokens.length).toBe(hidden ? 0 : 1);
    expect(view.initiative.length).toBe(hidden ? 0 : 1);
    expect(activeScene(state).tokens[0]).toMatchObject({ x: 50, y: 75, hp: { current: 8, max: 12 } });
  }
  const move = { op: 'moveToken' as const, tokenId: token.id, x: 90, y: 100 };
  applyOperation(state, move);
  expect(projectPatchOperations(state, [move], player)).toBeNull();
  expect(projectPatchOperations(state, [{ op: 'advanceTurn' }], player)).toBeNull();
  expect(projectPatchOperations(state, [{ op: 'previousTurn' }], player)).toBeNull();
  applyOperation(state, { op: 'removeToken', tokenId: token.id });
  expect(projectRoomState(state, player).scene.initiative).toEqual([]);
});
it('keeps legacy tokens visible, rejects invalid visibility and player changes', () => {
  const state = createInitialRoomState('test', 'test');
  activeScene(state).tokens.push({ id: 'old', kind: 'monster', name: 'old', entryId: null, x: 0, y: 0, size: 100, avatar: '', color: '#fff' });
  expect(projectRoomState(state, player).scene.tokens).toHaveLength(1);
  for (const hidden of ['false', 1, null]) expect(() => authorizeOperation({ op: 'updateToken', tokenId: 'old', patch: { hidden } }, state, dm)).toThrow();
  expect(() => authorizeOperation({ op: 'updateToken', tokenId: 'old', patch: { hidden: false } }, state, player)).toThrow();
});
