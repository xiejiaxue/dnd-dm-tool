import { expect, it } from 'vitest';
import { activeScene, applyOperation, authorizeOperation, createInitialRoomState, ensurePlayerToken, projectRoomState, type RoomActor } from '../src/domain';
import { projectPatchOperations } from '../src/room';

const dm: RoomActor = { userId: 'dm', memberId: 'dm', role: 'host', accessEpoch: 1 };
const player: RoomActor = { userId: 'pc-user', memberId: 'pc-member', role: 'player', accessEpoch: 1, characterId: 'c1', characterName: '莱拉', characterMaxHp: 18 };
const other: RoomActor = { ...player, userId: 'other-user', memberId: 'other-member', characterId: 'c2', characterName: '他人' };

it('keeps encounter HP DM-only in full projections', () => {
  const state = createInitialRoomState('test', 'test');
  const add = authorizeOperation({ op: 'addToken', token: { name: '恐狼', entryId: null, x: 0, y: 0, size: 100, avatar: '', color: '#fff', hp: { current: 20, max: 37 } } }, state, dm);
  applyOperation(state, add);
  const token = activeScene(state).tokens[0];
  applyOperation(state, authorizeOperation({ op: 'updateToken', tokenId: token.id, patch: { hidden: false } }, state, dm));
  expect(projectRoomState(state, dm).scene.tokens[0].hp).toEqual({ current: 20, max: 37 });
  const view = projectRoomState(state, player).scene.tokens;
  expect(view).toHaveLength(1);
  expect(view[0]).not.toHaveProperty('hp');
  // Token edits are always re-projected for players, so HP changes never leak as patches.
  const damage = authorizeOperation({ op: 'updateToken', tokenId: token.id, patch: { hp: { current: 5, max: 37 } } }, state, dm);
  applyOperation(state, damage);
  expect(projectPatchOperations(state, [damage], player)).toBeNull();
  expect(projectRoomState(state, player).scene.tokens[0]).not.toHaveProperty('hp');
});

it('lets players see only their own character HP', () => {
  const state = createInitialRoomState('test', 'test');
  ensurePlayerToken(state, player);
  ensurePlayerToken(state, other);
  const [mine, theirs] = activeScene(state).players;
  applyOperation(state, { op: 'updatePlayer', tokenId: mine.id, patch: { hp: { current: 11, max: 18 } } });
  applyOperation(state, { op: 'updatePlayer', tokenId: theirs.id, patch: { hp: { current: 3, max: 18 } } });
  const players = projectRoomState(state, player).scene.players;
  expect(players.find(p => p.id === mine.id)?.hp).toEqual({ current: 11, max: 18 });
  expect(players.find(p => p.id === theirs.id)).not.toHaveProperty('hp');
  expect(projectRoomState(state, dm).scene.players.find(p => p.id === theirs.id)?.hp).toEqual({ current: 3, max: 18 });

  const theirHp = { op: 'updatePlayer' as const, tokenId: theirs.id, patch: { hp: { current: 1, max: 18 } } };
  expect(projectPatchOperations(state, [theirHp], player)).toEqual([]);
  expect(projectPatchOperations(state, [theirHp], other)).toEqual([theirHp]);
  expect(projectPatchOperations(state, [theirHp], dm)).toEqual([theirHp]);
  const renameAndHp = { op: 'updatePlayer' as const, tokenId: theirs.id, patch: { name: '新名', hp: { current: 1, max: 18 } } };
  expect(projectPatchOperations(state, [renameAndHp], player)).toEqual([{ op: 'updatePlayer', tokenId: theirs.id, patch: { name: '新名' } }]);
});
