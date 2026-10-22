import { expect, it } from 'vitest';
import { activeScene, applyOperation, authorizeOperation, createInitialRoomState, type RoomActor } from '../src/domain';
const host: RoomActor = { userId: 'host', memberId: 'host', role: 'host', accessEpoch: 1 };
it('persists moderator initiative bonuses and validates their range', () => {
  const state = createInitialRoomState('test', 'test');
  applyOperation(state, authorizeOperation({ op: 'addToken', token: { id: 'a', name: '地精', kind: 'monster', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '', color: '#fff', initiativeBonus: 2 } }, state, host));
  const token = activeScene(state).tokens[0];
  expect(token.initiativeBonus).toBe(2);
  applyOperation(state, authorizeOperation({ op: 'updateToken', tokenId: token.id, patch: { initiativeBonus: -1 } }, state, host));
  expect(activeScene(state).tokens[0].initiativeBonus).toBe(-1);
  for (const value of [51, -51, 1.5, '2', NaN]) expect(() => authorizeOperation({ op: 'updateToken', tokenId: token.id, patch: { initiativeBonus: value } }, state, host)).toThrow();
  expect(() => authorizeOperation({ op: 'updateToken', tokenId: token.id, patch: { initiativeBonus: 9 } }, state, { ...host, role: 'player' })).toThrow();
});
