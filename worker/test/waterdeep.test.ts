import migration from '../campaign-migrations/0001_campaign_core.sql?raw';
import { SELF, reset, env } from 'cloudflare:test';
import { afterEach, beforeEach, it, expect } from 'vitest';
import { waterdeepIndex } from '../../shared/waterdeep';
beforeEach(async () => {
  const statements = migration.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean);
  for (const sql of statements) await env.DB.prepare(sql).run();
});
afterEach(async () => { await reset(); });
it('serves Waterdeep search, card and SVG with an empty R2 compendium', async () => {
  const npc = waterdeepIndex.find(n => n.nameZh === '珊娜萨')!;
  const search = await SELF.fetch('https://table.test/api/search?q='+encodeURIComponent(npc.nameZh)+'&type=monster');
  expect(search.status).toBe(200);
  expect(await search.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: npc.id })]));
  const card = await SELF.fetch(`https://table.test/api/entry/monster/${npc.id}`);
  expect(card.status).toBe(200);
  expect(await card.json()).toMatchObject({ name: npc.nameZh, hp: { average: 180 } });
  const token = await SELF.fetch(`https://table.test/api/token/${npc.id}`);
  expect(token.headers.get('content-type')).toContain('image/svg+xml');
  expect(await token.text()).toContain(npc.nameZh);
  const wrongType = await SELF.fetch(`https://table.test/api/entry/spell/${npc.id}`);
  expect(wrongType.status).toBe(404);
});
