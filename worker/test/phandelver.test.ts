import { env, SELF, reset, runInDurableObject } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it } from 'vitest';
import migration from '../campaign-migrations/0001_campaign_core.sql?raw';
import { CampaignStore } from '../src/campaign-store';
import { phandelverScenes } from '../src/modules/lost-mine-of-phandelver';
import { getPhandelverCard, phandelverIndex } from '../../shared/phandelver';
const base='https://table.test';
const api=(path:string,cookie='',body?:unknown)=>SELF.fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const visitor=async()=>(await api('/api/me')).headers.get('set-cookie')!.split(';')[0];
const prefix='room-templates/lost-mine-of-phandelver/';
beforeEach(async()=>{
  for(const sql of migration.split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n').split(';').filter(s=>s.trim()))await env.DB.prepare(sql).run();
  await env.REFERENCE_DATA.put(`${prefix}manifest.json`,JSON.stringify({scenes:phandelverScenes.map(s=>({name:s.name,map:s.map}))}));
  for(const s of phandelverScenes)await env.REFERENCE_DATA.put(`${prefix}assets/${s.map.assetId}`,'jpg',{httpMetadata:{contentType:'image/jpeg'}});
});
afterEach(async()=>{await reset();});
async function campaign(cookie:string){
  const modules=await (await api('/api/modules',cookie)).json() as any[];
  const module=modules.find(m=>m.name==='凡戴尔的失落矿坑');expect(module).toBeDefined();
  const r=await api('/api/campaigns',cookie,{moduleId:module.id});expect(r.status,await r.clone().text()).toBe(201);
  return ((await r.json()) as any).campaign;
}
const load=(id:string)=>runInDurableObject(env.ROOMS.getByName(`campaign:${id}`),(_instance,state)=>new CampaignStore(state.storage).load());

it('keeps every preset consistent with the cards and the extracted maps',()=>{
  expect(phandelverScenes).toHaveLength(7);
  for(const s of phandelverScenes){
    expect(s.map.assetId).toMatch(/^map-lmop-\d\d-[0-9a-f]{12}$/);
    expect(s.map.width).toBeGreaterThan(0);
    for(const e of s.encounters){
      expect(getPhandelverCard(e.entryId),e.entryId).toBeDefined();
      if(e.automatic){expect(e.count).toBeGreaterThan(0);expect(e.position).not.toBeNull();}
    }
  }
  expect(new Set(phandelverScenes.flatMap(s=>s.encounters.map(e=>e.key))).size).toBe(phandelverScenes.flatMap(s=>s.encounters).length);
});

it('imports all seven maps calibrated to the grid with hidden room tokens',async()=>{
  const cookie=await visitor(), a=await campaign(cookie), b=await campaign(cookie);
  const state=await load(a.id);
  const scenes=Object.values(state!.scenes);
  expect(scenes.map(s=>s.name).sort()).toEqual(phandelverScenes.map(s=>s.name));
  let count=0;
  for(const s of scenes){
    expect((await api(s.mapImage!,cookie)).status).toBe(200);
    expect((await api(s.mapImage!.replace(a.slug,b.slug),cookie)).status).toBe(404);
    for(const t of s.tokens){
      expect(t.hidden).toBe(true);expect(getPhandelverCard(t.entryId!)).toBeDefined();
      expect(t.x).toBeGreaterThan(0);expect(t.x).toBeLessThan(s.mapSize[0]*s.mapScale!);expect(t.y).toBeLessThan(s.mapSize[1]*s.mapScale!);
      count++;
    }
  }
  expect(count).toBe(phandelverScenes.flatMap(s=>s.encounters).filter(e=>e.automatic).reduce((n,e)=>n+e.count!,0));
  const overview=scenes.find(s=>s.name.startsWith('00'))!;expect(overview.tokens).toHaveLength(0);
  const hideout=scenes.find(s=>s.name.startsWith('01'))!;
  expect(hideout.tokens.find(t=>t.name.startsWith('修达'))?.hp).toEqual({current:1,max:27});
  const klarg=hideout.tokens.find(t=>t.name.startsWith('克拉格'))!;
  expect(klarg.size).toBe(100);expect(klarg.hp).toEqual({current:27,max:27});expect(klarg.initiativeBonus).toBe(2);
  const castle=scenes.find(s=>s.name.startsWith('04'))!;
  expect(castle.tokens.filter(t=>t.name.startsWith('地精 · 7'))).toHaveLength(7);
  expect(castle.tokens.find(t=>t.name.startsWith('枭熊'))?.size).toBe(200);
  expect(castle.tokens.find(t=>t.name.startsWith('甘德伦'))?.hp).toEqual({current:0,max:4});
  const cave=scenes.find(s=>s.name.startsWith('06'))!;
  expect(cave.tokens.filter(t=>t.name.startsWith('蚊蝠')).every(t=>t.size===50)).toBe(true);
});

it('serves scene presets and area notes to the DM only and adds a conditional encounter once per command',async()=>{
  const host=await visitor(), c=await campaign(host), player=await visitor();
  const state=await load(c.id);
  const scene=Object.values(state!.scenes).find(s=>s.name.startsWith('04'))!;
  const route=`/api/campaigns/${c.slug}/phandelver-scene/${scene.id}`;
  const preset=await (await api(route,host)).json() as any;
  expect(preset.areas.map((a:any)=>a.key)).toContain('14');
  const e=preset.encounters.find((e:any)=>e.name==='塔戈·血剑');
  expect(e.automatic).toBe(false);
  const body={id:'test-phandelver-command',encounterKey:e.key,count:1};
  expect((await api(route,host,body)).status).toBe(200);
  expect((await api(route,host,body)).status).toBe(200);
  expect((await api(route,host,{...body,id:'bad-count',count:0})).status).toBe(400);
  const after=await load(c.id);
  const added=after!.scenes[scene.id].tokens.filter(t=>t.entryId===e.entryId);
  expect(added).toHaveLength(1);expect(added[0].hp).toEqual({current:20,max:20});expect(added[0].hidden).toBe(true);
  expect(after!.currentSceneId).toBe(state!.currentSceneId);
  const inv=await (await api(`/api/campaigns/${c.slug}/invites`,host,{role:'player'})).json() as any;
  await api('/api/invites/redeem',player,{token:new URL(inv.inviteUrl,base).hash.slice(8)});
  expect((await api(route,player)).status).toBe(403);
  expect((await api(route,player,{...body,id:'player-try'})).status).toBe(403);
  const playerScene=await (await api(`/api/campaigns/${c.slug}/scenes/${scene.id}`,player)).json() as any;
  expect(playerScene.tokens).toEqual([]);
});

it('finds Chinese cards by name or by the alternative translation and draws their tokens',async()=>{
  const sildar=phandelverIndex.find(n=>n.nameZh==='修达·霍温特')!;
  for(const q of ['修达','西达尔'])
    expect(await (await api('/api/search?q='+encodeURIComponent(q))).json()).toEqual(expect.arrayContaining([expect.objectContaining({id:sildar.id})]));
  const card=await (await api('/api/entry/monster/LMOP__nezznar')).json() as any;
  expect(card.hp.average).toBe(27);expect(card.campaignCard.body.join('')).toContain('蜘蛛法杖');
  expect((await api('/api/token/LMOP__toblen')).headers.get('content-type')).toContain('image/svg+xml');
});

it('refuses to create the campaign when a map is missing',async()=>{
  await env.REFERENCE_DATA.delete(`${prefix}assets/${phandelverScenes[6].map.assetId}`);
  const cookie=await visitor();const mods=await (await api('/api/modules',cookie)).json() as any[];
  expect((await api('/api/campaigns',cookie,{moduleId:mods.find(m=>m.name==='凡戴尔的失落矿坑').id})).status).toBe(503);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM assets').first('n')).toBe(0);
});
