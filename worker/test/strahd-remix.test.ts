import { env, SELF, reset, runInDurableObject } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it } from 'vitest';
import migration from '../campaign-migrations/0001_campaign_core.sql?raw';
import { CampaignStore } from '../src/campaign-store';
import { strahdRemixScenes } from '../src/modules/curse-of-strahd-remix';
import { strahdScenes } from '../src/modules/curse-of-strahd/scenes';
import { getStrahdCard } from '../../shared/strahd';
import { getStrahdRemixCard, strahdRemixIndex } from '../../shared/strahd-remix';
const base='https://table.test';
const api=(path:string,cookie='',body?:unknown)=>SELF.fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const visitor=async()=>(await api('/api/me')).headers.get('set-cookie')!.split(';')[0];
const prefix='room-templates/curse-of-strahd-remix/';
const card=(id:string)=>getStrahdRemixCard(id) ?? getStrahdCard(id);
beforeEach(async()=>{
  for(const sql of migration.split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n').split(';').filter(s=>s.trim()))await env.DB.prepare(sql).run();
  await env.REFERENCE_DATA.put(`${prefix}manifest.json`,JSON.stringify({scenes:strahdRemixScenes.map(s=>({name:s.name,map:s.map}))}));
  for(const s of strahdRemixScenes)await env.REFERENCE_DATA.put(`${prefix}assets/${s.map.assetId}`,'png',{httpMetadata:{contentType:'image/png'}});
});
afterEach(async()=>{await reset();});
async function campaign(cookie:string){
  const modules=await (await api('/api/modules',cookie)).json() as any[];
  const module=modules.find(m=>m.name==='施特拉德的诅咒（重置版 v2）');expect(module).toBeDefined();
  const r=await api('/api/campaigns',cookie,{moduleId:module.id});expect(r.status,await r.clone().text()).toBe(201);
  return ((await r.json()) as any).campaign;
}
const load=(id:string)=>runInDurableObject(env.ROOMS.getByName(`campaign:${id}`),(_instance,state)=>new CampaignStore(state.storage).load());

it('reuses original Strahd maps under its own asset ids with known cards',()=>{
  expect(strahdRemixScenes).toHaveLength(18);
  const originals=new Map(strahdScenes.map(s=>[s.map.assetId.slice(-12),s]));
  for(const s of strahdRemixScenes){
    expect(s.map.assetId).toMatch(/^map-cosr-\d\d-[0-9a-f]{12}$/);
    const o=originals.get(s.map.assetId.slice(-12));expect(o,s.name).toBeDefined();
    expect([s.map.width,s.map.height]).toEqual([o!.map.width,o!.map.height]);
    expect(s.notes.length+s.areas!.length,s.name).toBeGreaterThan(0);
    for(const e of s.encounters){expect(card(e.entryId),e.entryId).toBeDefined();if(e.automatic)expect(e.position).not.toBeNull();}
  }
  // Every map lists its rooms by book code: v2 use (or default-empty) first, then the original text.
  for(const s of strahdRemixScenes){
    const rooms=s.areas!.filter(a=>!/^a\d+$/.test(a.key));
    expect(rooms.length,s.name).toBeGreaterThan(0);
    for(const a of rooms){expect(a.text,a.key).toMatch(/^【重置版】/);expect(a.text,a.key).toContain('【原版】');}
  }
  const k8=strahdRemixScenes.find(s=>s.key==='15')!.areas!.find(a=>a.key==='K8')!;
  expect(k8.text).toContain('预置 拉哈丁');expect(k8.text).toContain('石像鬼');
  expect(strahdRemixScenes.find(s=>s.key==='16')!.areas!.find(a=>a.key==='K25')!.text).toContain('默认不刷敌人或陷阱');
  expect(new Set(strahdRemixScenes.flatMap(s=>s.encounters.map(e=>e.key))).size).toBe(strahdRemixScenes.flatMap(s=>s.encounters).length);
});

it('creates a 重置版 campaign with only the reconstruction default groups',async()=>{
  const cookie=await visitor(), c=await campaign(cookie);
  const scenes=Object.values((await load(c.id))!.scenes);
  expect(scenes.map(s=>s.name).sort()).toEqual(strahdRemixScenes.map(s=>s.name));
  const tokens=scenes.flatMap(s=>s.tokens);
  expect(tokens).toHaveLength(strahdRemixScenes.flatMap(s=>s.encounters).filter(e=>e.automatic).reduce((n,e)=>n+e.count!,0));
  expect(tokens.every(t=>t.hidden && t.id.startsWith('cosr-'))).toBe(true);
  for(const s of scenes)expect((await api(s.mapImage!,cookie)).status).toBe(200);
  // The prologue wolves are optional: the overview map starts empty.
  expect(scenes.find(s=>s.name.startsWith('01'))!.tokens).toHaveLength(0);
  expect(scenes.find(s=>s.name.startsWith('17'))!.tokens.some(t=>t.entryId==='COSR__heart-of-sorrow')).toBe(false);
});

it('serves the v2 notes to the DM only and adds optional groups idempotently',async()=>{
  const host=await visitor(), c=await campaign(host), player=await visitor();
  const scene=Object.values((await load(c.id))!.scenes).find(s=>s.name.startsWith('01'))!;
  const route=`/api/campaigns/${c.slug}/strahd-remix-scene/${scene.id}`;
  const preset=await (await api(route,host)).json() as any;
  expect(preset.areas.some((a:any)=>a.name.startsWith('L0'))).toBe(true);
  expect(preset.areas.find((a:any)=>a.key==='B').text).toContain('【原版】');
  const e=preset.encounters.find((e:any)=>e.name==='施特拉德恐狼');expect(e.automatic).toBe(false);
  expect((await api(route,host,{id:'remix-cmd',encounterKey:e.key,count:2})).status).toBe(200);
  expect((await api(route,host,{id:'remix-cmd',encounterKey:e.key,count:2})).status).toBe(200);
  expect((await load(c.id))!.scenes[scene.id].tokens.filter(t=>t.entryId===e.entryId)).toHaveLength(2);
  const inv=await (await api(`/api/campaigns/${c.slug}/invites`,host,{role:'player'})).json() as any;
  await api('/api/invites/redeem',player,{token:new URL(inv.inviteUrl,base).hash.slice(8)});
  expect((await api(route,player)).status).toBe(403);
});

it('adds only its own cards to search and draws their tokens',async()=>{
  const hits=await (await api('/api/search?q='+encodeURIComponent('米哈伊'))).json() as any[];
  expect(hits.map(h=>h.id)).toContain('COSR__mihai');
  const heart=await (await api('/api/entry/monster/COSR__heart-of-sorrow')).json() as any;
  expect(heart.campaignCard.meta).toContain('重置版');
  expect((await api('/api/token/COSR__heart-of-sorrow')).headers.get('content-type')).toContain('image/svg+xml');
  expect(strahdRemixIndex.filter(n=>n.id.startsWith('COS__'))).toHaveLength(301);
});
