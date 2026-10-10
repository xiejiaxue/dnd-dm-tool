import { describe, expect, it } from 'vitest';
import { activeScene, applyOperation, authorizeOperation, createInitialRoomState, type RoomActor } from '../src/domain';
import { applyOptimisticOps } from '../../client/src/optimistic';
import { projectPatchOperations } from '../src/room';
import { fogGridSize, type Op } from '../../shared/types';

const host: RoomActor = { userId: 'host', memberId: 'member', role: 'host', accessEpoch: 1 };
function fixture() {
  const state = createInitialRoomState('test', 'test');
  applyOperation(state, authorizeOperation({ op: 'updateMap', mapImage: '/api/campaigns/test/assets/map', mapSize: [523, 377], playArea: { x: 0, y: 0, w: 523, h: 377 } }, state, host));
  return state;
}
describe('fog contract parity and token placement', () => {
  it('matches authoritative and optimistic fog through erase, resize, reveal and cover', () => {
    const state = fixture();let client = { scene: structuredClone(activeScene(state)), campaign: state.campaign };
    const operations: Op[] = [{ op: 'setFog', cells: [25, 26], revealed: true, basisScale: 1 }, { op: 'updateMapScale', mapScale: 2.5 }, { op: 'setFog', cells: [30], revealed: true, basisScale: 1 }, { op: 'revealAllFog' }, { op: 'coverAllFog' }, { op: 'updateMapScale', mapScale: 0.1 }];
    for (const input of operations) {
      const op = authorizeOperation(input, state, host);applyOperation(state, op);
      const patch = projectPatchOperations(state, [op], host)!;
      client = applyOptimisticOps(client, patch)! as typeof client;
      expect(client.scene).toEqual(activeScene(state));
      expect(fogGridSize(activeScene(state))).toEqual({ cols: 11, rows: 8 });
    }
  });
  it('synchronizes exact reveals, overlap, cell cover, reset and zoom to players', () => {
    const state=fixture(); const player={...host,role:'player' as const};
    let client={scene:structuredClone(activeScene(state)),campaign:state.campaign};
    const operations:Op[]=[
      {op:'revealFogRect',rect:{x:113.25,y:117.5,width:6.5,height:5.25}},
      {op:'updateMapScale',mapScale:1.37},
      {op:'revealFogRect',rect:{x:119,y:120,width:40,height:60}},
      {op:'setFog',cells:[24],revealed:false,basisScale:1},
      {op:'coverAllFog'},
      {op:'revealFogRect',rect:{x:23,y:37,width:4,height:8}},
      {op:'revealAllFog'},
      {op:'coverAllFog'},
      {op:'revealFogRect',rect:{x:23,y:37,width:4,height:8}},
      {op:'updateMap',mapImage:null,mapSize:[523,377],playArea:{x:0,y:0,w:523,h:377}},
    ];
    for(const input of operations) {
      const op=authorizeOperation(input,state,host);applyOperation(state,op);
      client=applyOptimisticOps(client,projectPatchOperations(state,[op],player)!)! as typeof client;
      expect(client.scene).toEqual(activeScene(state));
      if(['coverAllFog','revealAllFog','updateMap'].includes(op.op)) expect(client.scene.fogReveals).toBeUndefined();
    }
  });
  it('rejects invalid rectangles and player reveals, and clips to the exact map bounds', () => {
    const state=fixture();
    for(const rect of [null,{x:1,y:1,width:0,height:2},{x:NaN,y:1,width:2,height:2},{x:600,y:1,width:2,height:2}])
      expect(()=>authorizeOperation({op:'revealFogRect',rect},state,host)).toThrow();
    const input={op:'revealFogRect',rect:{x:500,y:350,width:100,height:100}};
    expect(authorizeOperation(input,state,host)).toEqual({op:'revealFogRect',rect:{x:500,y:350,width:23,height:27}});
    expect(()=>authorizeOperation(input,state,{...host,role:'player'})).toThrow();
  });
  it('rejects old scale-dependent brush indices instead of corrupting the new raster', () => {
    const state = fixture();applyOperation(state, { op: 'updateMapScale', mapScale: 2 });
    expect(() => authorizeOperation({ op: 'setFog', cells: [25], revealed: true }, state, host)).toThrow('迷雾坐标已更新');
    expect(authorizeOperation({ op: 'setFog', cells: [25], revealed: true, basisScale: 1 }, state, host)).toMatchObject({ basisScale: 1 });
  });
  it('restores an explicit legacy fog density without flattening its revealed cells', () => {
    const state = fixture();
    applyOperation(state, authorizeOperation({ op: 'updateMap', mapImage: '/api/campaigns/test/assets/map', mapSize: [523, 377], playArea: { x: 0, y: 0, w: 523, h: 377 }, fogBasisScale: 2 }, state, host));
    applyOperation(state, authorizeOperation({ op: 'updateMapScale', mapScale: 3 }, state, host));
    applyOperation(state, authorizeOperation({ op: 'setFog', cells: [200], revealed: true, basisScale: 2 }, state, host));
    expect(activeScene(state).fog).toHaveLength(336);expect(activeScene(state).fog![200]).toBe(true);
  });
  it('accepts the existing compendium avatar route and persists a server-owned enemy ID', () => {
    const state = fixture();
    const input = { op: 'addToken', token: { id: 'client-id', kind: 'monster', name: '哥布林', entryId: 'MM__Goblin', x: 200, y: 250, size: 100, avatar: '/api/token/MM__Goblin', color: '#fff' } };
    const op = authorizeOperation(input, state, host);applyOperation(state, op);
    const token = activeScene(state).tokens[0];expect(token.avatar).toBe('/api/token/MM__Goblin');expect(token.id).not.toBe('client-id');expect(token.number).toBe(1);
    expect(projectPatchOperations(state, [op], host)).toEqual([{ op: 'addToken', token }]);
    expect(() => authorizeOperation({ ...input, token: { ...input.token, avatar: 'https://other.test/evil.png' } }, state, host)).toThrow();
    expect(() => authorizeOperation(input, state, { ...host, role: 'player' })).toThrow();
    expect(() => authorizeOperation({ op: 'updateMap', mapImage: '/api/token/MM__Goblin', mapSize: [523,377], playArea: {x:0,y:0,w:523,h:377} }, state, host)).toThrow();
  });
});
