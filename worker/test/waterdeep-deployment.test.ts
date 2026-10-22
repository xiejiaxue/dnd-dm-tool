import { expect, it } from 'vitest';
import presets from '../../shared/waterdeep/deployment.json';
import { deployWaterdeep } from '../src/modules/waterdeep-dragon-heist/deployment';
import { createInitialRoomState, addScene, projectRoomState, type RoomActor } from '../src/domain';
const host: RoomActor = {userId:'h',memberId:'h',role:'host',accessEpoch:1};
it('previews all 21 scenes, preserves existing units and current scene, scales placements and is idempotent', () => {
  const state=createInitialRoomState('深水城','深水城');
  for(const preset of presets) { const scene=addScene(state,preset.match); scene.mapImage='/api/campaigns/test/map';scene.mapSize=[1000,800];scene.mapScale=2; }
  const first=Object.values(state.scenes).find(s=>s.name===presets[0].match)!;
  first.tokens.push({id:'manual',kind:'monster',entryId:presets[0].tokens[0].entryId,name:'已有',x:45,y:90,size:100,avatar:'',color:'#fff',hp:{current:2,max:13}});
  state.currentSceneId=first.id;
  const before=JSON.stringify(state);
  const preview=deployWaterdeep(state,host);
  expect(preview.rows).toHaveLength(21);expect(JSON.stringify(state)).toBe(before);
  const result=deployWaterdeep(state,host,true);
  expect(result.added).toBe(presets.reduce((n,p)=>n+p.tokens.length,0)-1);
  expect(state.currentSceneId).toBe(first.id);
  expect(first.tokens[0]).toMatchObject({id:'manual',x:45,y:90,hp:{current:2,max:13}});
  expect(first.tokens[1].x).toBe(presets[0].tokens[1].x*2000);
  for(const scene of Object.values(state.scenes)) for(const t of scene.tokens.filter(t=>t.id!=='manual')) {
    expect(t.hidden).toBe(true);expect(t.hp!.max).toBeGreaterThan(0);expect(t.x).toBeGreaterThanOrEqual(0);expect(t.x).toBeLessThanOrEqual(2000);expect(t.y).toBeLessThanOrEqual(1600);
  }
  expect(deployWaterdeep(state,host,true).added).toBe(0);
  expect(projectRoomState(state,{...host,role:'player'}).scene.tokens.map(t=>t.id)).toEqual(['manual']);
  expect(()=>deployWaterdeep(state,{...host,role:'player'},true)).toThrow();
});
it('refuses ambiguous scene names without changing existing scenes',()=>{
  const state=createInitialRoomState('x','x');addScene(state,'地图8.1 a');addScene(state,'地图8.1 b');
  expect(deployWaterdeep(state,host,true).rows.find(r=>r.scene==='地图8.1')?.note).toContain('多个');
});
