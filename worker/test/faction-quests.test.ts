import { expect, it } from 'vitest';
import { activeCampaign, applyOperation, authorizeOperation, createInitialRoomState, ensurePlayerToken, projectRoomState, type RoomActor } from '../src/domain';
import { projectPatchOperations } from '../src/room';
import { applyOptimisticOps } from '../../client/src/optimistic';

const host: RoomActor = { userId: 'host', memberId: 'host-member', role: 'host', accessEpoch: 1 };
const player: RoomActor = { userId: 'pc', memberId: 'pc-member', role: 'player', accessEpoch: 1, characterId: 'c1', characterName: '莱拉' };

it('lets the DM track quest status and faction notes that players never receive', () => {
  const state = createInitialRoomState('test', 'test');
  ensurePlayerToken(state, player);
  const ops = [
    authorizeOperation({ op: 'setQuestStatus', questId: 'harpers:H1', status: 'active' }, state, host),
    authorizeOperation({ op: 'setFactionNote', factionId: 'harpers', note: '米尔特已预付 25gp' }, state, host),
  ];
  for (const op of ops) applyOperation(state, op);
  expect(activeCampaign(state)).toMatchObject({ questProgress: { 'harpers:H1': 'active' }, factionNotes: { harpers: '米尔特已预付 25gp' } });

  const view = projectRoomState(state, player).campaign;
  expect(view.questProgress).toBeUndefined();
  expect(view.factionNotes).toBeUndefined();
  expect(projectPatchOperations(state, ops, player)).toEqual([]);
  expect(projectPatchOperations(state, ops, host)).toEqual(ops);

  // The optimistic client reaches the same campaign as the room.
  const predicted = applyOptimisticOps({ scene: projectRoomState(createInitialRoomState('t', 't'), host).scene, campaign: { id: 'c', name: 'c', sceneIds: [], enemies: [] } }, ops);
  expect(predicted?.campaign).toMatchObject({ questProgress: { 'harpers:H1': 'active' }, factionNotes: { harpers: '米尔特已预付 25gp' } });

  // Back to 'open' and an empty note remove the entries.
  applyOperation(state, authorizeOperation({ op: 'setQuestStatus', questId: 'harpers:H1', status: 'open' }, state, host));
  applyOperation(state, authorizeOperation({ op: 'setFactionNote', factionId: 'harpers', note: '  ' }, state, host));
  expect(activeCampaign(state)).toMatchObject({ questProgress: {}, factionNotes: {} });
});

it('rejects invalid tracking edits and any edit from players', () => {
  const state = createInitialRoomState('test', 'test');
  expect(() => authorizeOperation({ op: 'setQuestStatus', questId: 'harpers:H1', status: 'won' }, state, host)).toThrow('任务状态无效');
  expect(() => authorizeOperation({ op: 'setFactionNote', factionId: 'harpers', note: 'x'.repeat(4_001) }, state, host)).toThrow('派系备注');
  expect(() => authorizeOperation({ op: 'setQuestStatus', questId: 'harpers:H1', status: 'done' }, state, player)).toThrow();
});
