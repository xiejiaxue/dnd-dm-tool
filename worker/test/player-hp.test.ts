import { expect, it } from 'vitest';
import { activeScene, applyOperation, authorizeOperation, createInitialRoomState, ensurePlayerToken, type RoomActor } from '../src/domain';

const player: RoomActor = { userId: 'pc-user', memberId: 'pc-member', role: 'player', accessEpoch: 1, characterId: 'c1', characterName: '莱拉', characterMaxHp: 18 };
const other: RoomActor = { ...player, userId: 'other-user', memberId: 'other-member', characterId: 'c2', characterName: '他人' };

it('lets a player set their own HP but not initiative bonuses or another player', () => {
  const state = createInitialRoomState('test', 'test');
  ensurePlayerToken(state, player);
  ensurePlayerToken(state, other);
  const [mine, theirs] = activeScene(state).players;
  const op = authorizeOperation({ op: 'updatePlayer', tokenId: mine.id, patch: { hp: { current: 11, max: 18 }, initiativeBonus: 5 } }, state, player);
  expect(op).toEqual({ op: 'updatePlayer', tokenId: mine.id, patch: { hp: { current: 11, max: 18 } } });
  applyOperation(state, op);
  expect(activeScene(state).players[0].hp).toEqual({ current: 11, max: 18 });
  expect(() => authorizeOperation({ op: 'updatePlayer', tokenId: theirs.id, patch: { hp: { current: 1, max: 18 } } }, state, player)).toThrow('只能编辑自己的角色');
  expect(() => authorizeOperation({ op: 'updatePlayer', tokenId: mine.id, patch: { initiativeBonus: 5 } }, state, player)).toThrow('没有可更新字段');
});
