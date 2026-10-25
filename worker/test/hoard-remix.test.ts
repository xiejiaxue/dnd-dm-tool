import { env, SELF, reset, runInDurableObject } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it } from 'vitest';
import migration from '../campaign-migrations/0001_campaign_core.sql?raw';
import { CampaignStore } from '../src/campaign-store';
import { hoardRemixScenes } from '../src/modules/hoard-of-the-dragon-queen-remix';
import { hoardScenes } from '../src/modules/hoard-of-the-dragon-queen';
import { getHoardCard } from '../../shared/hoard';
import { getHoardRemixCard, hoardRemixIndex } from '../../shared/hoard-remix';
const base='https://table.test';
const api=(path:string,cookie='',body?:unknown)=>SELF.fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const visitor=async()=>(await api('/api/me')).headers.get('set-cookie')!.split(';')[0];
const prefix='room-templates/hoard-of-the-dragon-queen-remix/';
const card=(id:string)=>getHoardRemixCard(id) ?? getHoardCard(id);
beforeEach(async()=>{
  for(const sql of migration.split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n').split(';').filter(s=>s.trim()))await env.DB.prepare(sql).run();
  await env.REFERENCE_DATA.put(`${prefix}manifest.json`,JSON.stringify({scenes:hoardRemixScenes.map(s=>({name:s.name,map:s.map}))}));
  for(const s of hoardRemixScenes)await env.REFERENCE_DATA.put(`${prefix}assets/${s.map.assetId}`,'jpg',{httpMetadata:{contentType:'image/jpeg'}});
});
afterEach(async()=>{await reset();});
async function campaign(cookie:string){
  const modules=await (await api('/api/modules',cookie)).json() as any[];
  const module=modules.find(m=>m.name==='龙后的宝山（重置版）');expect(module).toBeDefined();
  const r=await api('/api/campaigns',cookie,{moduleId:module.id});expect(r.status,await r.clone().text()).toBe(201);
  return ((await r.json()) as any).campaign;
}
const load=(id:string)=>runInDurableObject(env.ROOMS.getByName(`campaign:${id}`),(_instance,state)=>new CampaignStore(state.storage).load());

it('keeps the reprint presets on the original maps with their own asset ids and known cards',()=>{
  expect(hoardRemixScenes).toHaveLength(13);
  hoardRemixScenes.forEach((s,i)=>{
    expect(s.map.assetId).toMatch(/^map-hdqr-\d\d-[0-9a-f]{12}$/);
    expect(s.map.assetId.slice(-12)).toBe(hoardScenes[i].map.assetId.slice(-12));
    expect(s.map.mapScale).toBe(hoardScenes[i].map.mapScale);
    for(const e of s.encounters){expect(card(e.entryId),e.entryId).toBeDefined();if(e.automatic)expect(e.position).not.toBeNull();}
    expect(s.areas!.length).toBeGreaterThanOrEqual(hoardScenes[i].areas!.length);
  });
  expect(new Set(hoardRemixScenes.flatMap(s=>s.encounters.map(e=>e.key))).size).toBe(hoardRemixScenes.flatMap(s=>s.encounters).length);
});

it('creates a 重置版 campaign with only the reconstruction default groups',async()=>{
  const cookie=await visitor(), c=await campaign(cookie);
  const state=await load(c.id);
  const scenes=Object.values(state!.scenes);
  expect(scenes.map(s=>s.name).sort()).toEqual(hoardRemixScenes.map(s=>s.name));
  const tokens=scenes.flatMap(s=>s.tokens);
  expect(tokens).toHaveLength(hoardRemixScenes.flatMap(s=>s.encounters).filter(e=>e.automatic).reduce((n,e)=>n+e.count!,0));
  expect(tokens.every(t=>t.hidden && t.id.startsWith('hdqr-'))).toBe(true);
  for(const s of scenes)expect((await api(s.mapImage!,cookie)).status).toBe(200);
  const hatchery=scenes.find(s=>s.name.startsWith('03'))!;
  expect(hatchery.tokens.some(t=>t.name.startsWith('石绳怪'))).toBe(false);
  expect(hatchery.tokens.filter(t=>t.name.startsWith('护卫龙兽'))).toHaveLength(1);
  const carnath=scenes.find(s=>s.name.startsWith('04'))!;
  expect(carnath.tokens.find(t=>t.entryId==='HDQR__bog-luck')?.hp).toEqual({current:58,max:58});
  const skyreach=scenes.find(s=>s.name.startsWith('12'))!;
  expect(skyreach.tokens.some(t=>t.name.startsWith('闷人毯'))).toBe(false);
  expect(skyreach.tokens.filter(t=>t.name.startsWith('瑞兹米尔'))).toHaveLength(1);
});

it('serves the reprint preset to the DM only, with original room notes kept as reference',async()=>{
  const host=await visitor(), c=await campaign(host), player=await visitor();
  const state=await load(c.id);
  const scene=Object.values(state!.scenes).find(s=>s.name.startsWith('04'))!;
  const route=`/api/campaigns/${c.slug}/hoard-remix-scene/${scene.id}`;
  const preset=await (await api(route,host)).json() as any;
  const vault=preset.areas.find((a:any)=>a.key==='4');
  expect(vault.text).toContain('重置版：');expect(vault.text).toContain('原版参考：');expect(vault.text).toContain('A1');
  const e=preset.encounters.find((e:any)=>e.name==='蜥蜴人');expect(e.automatic).toBe(false);
  expect((await api(route,host,{id:'remix-cmd',encounterKey:e.key,count:4})).status).toBe(200);
  expect((await api(route,host,{id:'remix-cmd',encounterKey:e.key,count:4})).status).toBe(200);
  expect((await load(c.id))!.scenes[scene.id].tokens.filter(t=>t.entryId===e.entryId)).toHaveLength(4);
  const inv=await (await api(`/api/campaigns/${c.slug}/invites`,host,{role:'player'})).json() as any;
  await api('/api/invites/redeem',player,{token:new URL(inv.inviteUrl,base).hash.slice(8)});
  expect((await api(route,player)).status).toBe(403);
});

it('adds only its own cards to search and draws their tokens',async()=>{
  const hits=await (await api('/api/search?q='+encodeURIComponent('博格'))).json() as any[];
  expect(hits.map(h=>h.id)).toEqual(expect.arrayContaining(['HDQ__bog-luck','HDQR__bog-luck']));
  expect(hits.filter(h=>h.id==='HDQ__bog-luck')).toHaveLength(1);
  const bog=await (await api('/api/entry/monster/HDQR__bog-luck')).json() as any;
  expect(bog.campaignCard.meta).toContain('重置版');
  expect((await api('/api/token/HDQR__bog-luck')).headers.get('content-type')).toContain('image/svg+xml');
  expect(hoardRemixIndex.find(n=>n.id==='HDQ__snapjaw')?.chapters).toContain('B 涅瑞塔');
});
