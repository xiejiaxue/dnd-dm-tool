import { describe, expect, it } from 'vitest';
import { activeScene, applyOperation, authorizeOperation, createInitialRoomState, projectRoomState, type RoomActor } from '../src/domain';
import { projectPatchOperations } from '../src/room';

const host: RoomActor = { userId: 'host-user', memberId: 'host-member', role: 'host', accessEpoch: 1 };
const player: RoomActor = { userId: 'player-user', memberId: 'player-member', role: 'player', accessEpoch: 1 };

function table() {
  const state = createInitialRoomState('Tools table', 'Tools campaign');
  const scene = activeScene(state);
  scene.tokens.push({ id: 'goblin', kind: 'monster', name: '地精', entryId: null, x: 0, y: 0, size: 100, avatar: '', color: '#000' });
  scene.players.push(
    { id: 'hero', kind: 'player', name: '莱拉', entryId: null, x: 0, y: 0, size: 48, avatar: '', color: '#fff', sessionId: 'player-user' },
    { id: 'other', kind: 'player', name: '博克', entryId: null, x: 0, y: 0, size: 48, avatar: '', color: '#fff', sessionId: 'other-user' },
  );
  return state;
}
const run = (state: ReturnType<typeof table>, actor: RoomActor, op: unknown) => applyOperation(state, authorizeOperation(op, state, actor));

describe('token conditions in the room', () => {
  it('lets the DM set conditions and a player only their own', () => {
    const state = table();
    run(state, host, { op: 'updateToken', tokenId: 'goblin', patch: { conditions: [{ id: 'prone' }, { id: 'poisoned', rounds: 2 }] } });
    expect(activeScene(state).tokens[0].conditions).toEqual([{ id: 'poisoned', rounds: 2 }, { id: 'prone' }]);
    run(state, player, { op: 'updatePlayer', tokenId: 'hero', patch: { conditions: [{ id: 'concentrating' }] } });
    expect(activeScene(state).players[0].conditions).toEqual([{ id: 'concentrating' }]);
    expect(() => authorizeOperation({ op: 'updatePlayer', tokenId: 'other', patch: { conditions: [] } }, state, player)).toThrow('只能编辑自己的角色');
    expect(() => authorizeOperation({ op: 'updateToken', tokenId: 'goblin', patch: { conditions: [] } }, state, player)).toThrow();
    expect(() => authorizeOperation({ op: 'updateToken', tokenId: 'goblin', patch: { conditions: [{ id: 'cursed' }] } }, state, host)).toThrow('未知状态');
    expect(() => authorizeOperation({ op: 'updateToken', tokenId: 'goblin', patch: { conditions: [{ id: 'prone', rounds: 1.5 }] } }, state, host)).toThrow();
  });

  it('counts timed conditions down when their creature starts its turn', () => {
    const state = table();
    const scene = activeScene(state);
    scene.tokens[0].conditions = [{ id: 'stunned', rounds: 1 }];
    scene.initiative.push({ id: 'i-g', name: '地精', value: 15, source: 'dm', sessionId: null, tokenId: 'goblin', active: false });
    applyOperation(state, { op: 'advanceTurn' });
    expect(activeScene(state).tokens[0].conditions).toEqual([]);
  });
});

describe('map notes in the room', () => {
  it('validates notes and sends players only the visible ones', () => {
    const state = table();
    run(state, host, { op: 'addMapNote', note: { id: 'secret', x: 5, y: 5, title: '暗门', text: '', visible: false } });
    run(state, host, { op: 'addMapNote', note: { id: 'open', x: 9, y: 9, title: '告示牌', text: '欢迎', visible: true, journal: { id: 'j1', title: '城镇' } } });
    expect(projectRoomState(state, host).scene.notes!.map(n => n.id)).toEqual(['secret', 'open']);
    expect(projectRoomState(state, player).scene.notes!.map(n => n.id)).toEqual(['open']);
    expect(() => authorizeOperation({ op: 'addMapNote', note: { id: 'bad id!', x: 0, y: 0, title: 'x' } }, state, host)).toThrow('ID 格式无效');
    expect(() => authorizeOperation({ op: 'addMapNote', note: { id: 'n', x: 0, y: 0, title: 'x' } }, state, player)).toThrow();
    const reveal = authorizeOperation({ op: 'updateMapNote', noteId: 'secret', patch: { visible: true } }, state, host);
    applyOperation(state, reveal);
    expect(projectPatchOperations(state, [reveal], player)).toBeNull();
    expect(projectPatchOperations(state, [reveal], host)).toEqual([reveal]);
  });
});

describe('table music and handouts', () => {
  it('only syncs the site\'s own recordings and stamps the room clock', () => {
    const state = table();
    const music = { trackId: 'city', title: 'Lord of the Land', url: '/music/city-v1.mp3', playing: true, position: 3, loop: true, updatedAt: 1 };
    const op = authorizeOperation({ op: 'setMusic', music }, state, host);
    expect(op).toMatchObject({ op: 'setMusic', music: { url: '/music/city-v1.mp3', position: 3 } });
    expect((op as { music: { updatedAt: number } }).music.updatedAt).toBeGreaterThan(1);
    applyOperation(state, op);
    expect(projectRoomState(state, player).campaign.music?.trackId).toBe('city');
    expect(projectPatchOperations(state, [op], player)).toEqual([op]);
    for (const url of ['https://evil.test/a.mp3', '/music/../secret.mp3', '/api/campaigns/x/assets/1'])
      expect(() => authorizeOperation({ op: 'setMusic', music: { ...music, url } }, state, host)).toThrow('只能同步本站配乐');
    expect(() => authorizeOperation({ op: 'setMusic', music }, state, player)).toThrow();
    applyOperation(state, authorizeOperation({ op: 'setMusic', music: null }, state, host));
    expect(state.campaign.music).toBeUndefined();
  });

  it('shows players only the handout on screen', () => {
    const state = table();
    const image = '/api/campaigns/tools/assets/one';
    run(state, host, { op: 'showHandout', handout: { id: 'h1', title: '旧地图', image } });
    run(state, host, { op: 'showHandout', handout: { id: 'h2', title: '', image } });
    expect(state.campaign.handouts!.map(h => h.title)).toEqual(['展示', '旧地图']);
    expect(projectRoomState(state, player).campaign.handouts!.map(h => h.id)).toEqual(['h2']);
    run(state, host, { op: 'hideHandout' });
    expect(projectRoomState(state, player).campaign.handouts).toBeUndefined();
    expect(projectRoomState(state, host).campaign.handouts).toHaveLength(2);
    expect(() => authorizeOperation({ op: 'showHandout', handout: { id: 'h3', title: 'x', image: 'https://evil.test/x.png' } }, state, host)).toThrow();
    expect(() => authorizeOperation({ op: 'hideHandout' }, state, player)).toThrow();
  });
});
