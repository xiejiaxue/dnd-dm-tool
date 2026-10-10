import { describe, expect, it } from 'vitest';
import { activeScene, applyOperation, createInitialRoomState, type RoomActor } from '../src/domain';
import { projectPatchOperations } from '../src/room';

const host: RoomActor = { userId: 'host-user', memberId: 'host-member', role: 'host', accessEpoch: 1 };
const player: RoomActor = { userId: 'viewer-user', memberId: 'viewer-member', role: 'player', accessEpoch: 1 };

describe('room operation patches', () => {
  it('keeps common board edits small while redacting another player identity', () => {
    const state = createInitialRoomState('Patch table', 'Patch campaign');
    const scene = activeScene(state);
    scene.players.push({
      id: 'other-player', kind: 'player', name: 'Other', entryId: null,
      x: 10, y: 20, size: 48, avatar: '', color: '#fff', sessionId: 'other-user',
    });
    const operation = { op: 'updatePlayer' as const, tokenId: 'other-player', patch: { name: 'Renamed', sessionId: 'other-user' } };
    applyOperation(state, operation);

    expect(projectPatchOperations(state, [operation], player)).toEqual([{
      op: 'updatePlayer', tokenId: 'other-player', patch: { name: 'Renamed', sessionId: null },
    }]);
    expect(projectPatchOperations(state, [{ op: 'updateMapScale', mapScale: 1.25 }], host)).toEqual([
      { op: 'updateMapScale', mapScale: 1.25, fogBasisScale: 1 },
    ]);
  });

  it('does not send DM-only encounter changes to player patches and falls back only for generated initiative entries', () => {
    const state = createInitialRoomState('Patch table', 'Patch campaign');
    const addEnemy = { op: 'addEnemy' as const, entryId: 'MM__Goblin', nameZh: '地精' };
    applyOperation(state, addEnemy);
    expect(projectPatchOperations(state, [addEnemy], player)).toEqual([]);
    expect(projectPatchOperations(state, [{ op: 'advanceTurn' }], host)).toEqual([{ op: 'advanceTurn' }]);
    expect(projectPatchOperations(state, [{ op: 'addToInitiative', name: 'Goblin', value: 12, source: 'dm', tokenId: null }], host)).toBeNull();
  });
});
