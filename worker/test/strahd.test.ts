import { env, SELF, reset, runInDurableObject } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it } from 'vitest';
import migration from '../campaign-migrations/0001_campaign_core.sql?raw';
import { CampaignStore } from '../src/campaign-store';
import { strahdScenes } from '../src/modules/curse-of-strahd/scenes';
import { getStrahdCard, strahdIndex } from '../../shared/strahd';
const base='https://table.test';
const api=(path:string,cookie='',body?:unknown)=>SELF.fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const visitor=async()=>(await api('/api/me')).headers.get('set-cookie')!.split(';')[0];
beforeEach(async()=>{
  for(const sql of migration.split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n').split(';').filter(s=>s.trim()))await env.DB.prepare(sql).run();
  await env.REFERENCE_DATA.put('room-templates/curse-of-strahd/manifest.json',JSON.stringify({scenes:strahdScenes.map(s=>({name:s.name,map:s.map}))}));
  for(const s of strahdScenes)await env.REFERENCE_DATA.put(`room-templates/curse-of-strahd/assets/${s.map.assetId}`,'png',{httpMetadata:{contentType:'image/png'}});
});
afterEach(async()=>{await reset();});
async function campaign(cookie:string){
  const modules=await (await api('/api/modules',cookie)).json() as any[];
  const module=modules.find(m=>m.name==='施特拉德的诅咒');expect(module).toBeDefined();
  const r=await api('/api/campaigns',cookie,{moduleId:module.id});expect(r.status,await r.clone().text()).toBe(201);
  return ((await r.json()) as any).campaign;
}
it('imports every map with scenario HP, hidden tokens, stable scene references and isolated campaign assets',async()=>{
  const cookie=await visitor(), a=await campaign(cookie), b=await campaign(cookie);
  const state=await runInDurableObject(env.ROOMS.getByName(`campaign:${a.id}`),(_instance,state)=>new CampaignStore(state.storage).load());
  expect(Object.values(state!.scenes)).toHaveLength(36);
  let count=0;
  for(const s of Object.values(state!.scenes)){
    expect((await api(s.mapImage!,cookie)).status).toBe(200);
    expect((await api(s.mapImage!.replace(a.slug,b.slug),cookie)).status).toBe(404);
    for(const t of s.tokens){expect(t.hidden).toBe(true);expect(getStrahdCard(t.entryId!)).toBeDefined();expect(t.x).toBeGreaterThan(0);expect(t.x).toBeLessThan(s.mapSize[0]*s.mapScale!);expect(t.y).toBeLessThan(s.mapSize[1]*s.mapScale!);count++;}
  }
  expect(count).toBe(505);
  const church=Object.values(state!.scenes).find(s=>s.name.startsWith('04'))!;
  expect(church.tokens.find(t=>t.name.startsWith('多鲁'))?.hp).toEqual({current:82,max:82});
  const winery=Object.values(state!.scenes).find(s=>s.name.startsWith('31'))!;
  expect(winery.tokens.filter(t=>t.name.startsWith('枯针怪'))).toHaveLength(35);
  const deathHouse=Object.values(state!.scenes).find(s=>s.name.startsWith('36'))!;
  expect(deathHouse.tokens.filter(t=>t.name.startsWith('食尸鬼'))).toHaveLength(4);
  expect(deathHouse.tokens.some(t=>t.name.startsWith('幽影'))).toBe(false);
  const first=Object.values(state!.scenes).find(s=>s.name.startsWith('01'))!;expect(first.tokens).toHaveLength(0);
  const before=JSON.stringify(state);
  await api(`/api/campaigns/${a.slug}`,cookie);
  const reloaded=await runInDurableObject(env.ROOMS.getByName(`campaign:${a.id}`),(_instance,state)=>new CampaignStore(state.storage).load());
  expect(JSON.stringify(reloaded)).toBe(before);
});
it('keeps encounter notes DM-only and applies a conditional encounter exactly once per command',async()=>{
  const host=await visitor(), c=await campaign(host), player=await visitor();
  const state=await runInDurableObject(env.ROOMS.getByName(`campaign:${c.id}`),(_instance,state)=>new CampaignStore(state.storage).load());
  const scene=Object.values(state!.scenes).find(s=>s.name.startsWith('36'))!;
  const route=`/api/campaigns/${c.slug}/strahd-scene/${scene.id}`;
  const preset=await (await api(route,host)).json() as any;
  const e=preset.encounters.find((e:any)=>e.name==='幽影');
  expect(e.count).toBe(5);expect(e.automatic).toBe(false);
  const body={id:'test-strahd-command',encounterKey:e.key,count:5};
  expect((await api(route,host,body)).status).toBe(200);
  expect((await api(route,host,body)).status).toBe(200);
  expect((await api(route,host,{...body,id:'bad-count',count:101})).status).toBe(400);
  const after=await runInDurableObject(env.ROOMS.getByName(`campaign:${c.id}`),(_instance,state)=>new CampaignStore(state.storage).load());
  expect(after!.scenes[scene.id].tokens).toHaveLength(scene.tokens.length+5);
  expect(after!.currentSceneId).toBe(state!.currentSceneId);
  const inv=await (await api(`/api/campaigns/${c.slug}/invites`,host,{role:'player'})).json() as any;
  await api('/api/invites/redeem',player,{token:new URL(inv.inviteUrl,base).hash.slice(8)});
  expect((await api(route,player)).status).toBe(403);
  expect((await api(route,player,{...body,id:'player-try'})).status).toBe(403);
  const playerScene=await (await api(`/api/campaigns/${c.slug}/scenes/${scene.id}`,player)).json() as any;
  expect(playerScene.tokens).toEqual([]);
});
it('exposes complete Chinese cards and token art without requiring external compendium data',async()=>{
  const n=strahdIndex.find(n=>n.nameZh==='多鲁')!;
  expect(await (await api('/api/search?q='+encodeURIComponent('多鲁'))).json()).toEqual(expect.arrayContaining([expect.objectContaining({id:n.id})]));
  const card=await (await api('/api/entry/monster/'+n.id)).json() as any;
  expect(card.hp.average).toBe(82);expect(card.campaignCard.body.join('')).toContain('蛛行');
  expect((await api('/api/token/'+n.id)).headers.get('content-type')).toContain('image/svg+xml');
  expect((await api('/api/entry/spell/'+n.id)).status).toBe(404);
});
it('fails before creating asset records if one of the required maps is absent',async()=>{
  await env.REFERENCE_DATA.delete(`room-templates/curse-of-strahd/assets/${strahdScenes[35].map.assetId}`);
  const cookie=await visitor();const mods=await (await api('/api/modules',cookie)).json() as any[];
  expect((await api('/api/campaigns',cookie,{moduleId:mods.find(m=>m.name==='施特拉德的诅咒').id})).status).toBe(503);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM assets').first('n')).toBe(0);
});
