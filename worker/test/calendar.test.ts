import migration from '../campaign-migrations/0001_campaign_core.sql?raw';
import { SELF, reset, env } from 'cloudflare:test';
import { afterEach, beforeEach, it, expect } from 'vitest';
import { calendarPayload } from '../src/calendar';
beforeEach(async () => {
  for (const sql of migration.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
});
afterEach(async () => { await reset(); });
const get = (path: string, cookie = '') => SELF.fetch(`https://table.test${path}`, { headers: { cookie } });
it('public payload contains only civic activities without sources or secret conditions', () => {
  for (const role of [null, 'player', 'spectator', 'unknown']) {
    const payload = calendarPayload(role);
    expect(payload.canManage).toBe(false);
    expect(payload.events.every(e => e.public && !e.condition && !e.source)).toBe(true);
    expect(payload.events.some(e => e.id === 'parades')).toBe(true);
    expect(payload.events.every(e => e.flavor?.speaker && e.flavor?.text && e.flavor?.background)).toBe(true);
    expect(payload.events.some(e => e.id === 'leiruin')).toBe(true);
    for (const secret of ['猩红盛宴', '灵魂契约', '达拉哈尔', '贾拉索', '守备空窗']) expect(JSON.stringify(payload)).not.toContain(secret);
    expect(payload.events.some(e => ['arrival', 'opening', 'fireball', 'feast', 'souls', 'stone-theft', 'ships-window'].includes(e.id))).toBe(false);
  }
  for (const role of ['host', 'dm', 'assistant_dm']) expect(calendarPayload(role).events.some(e => e.id === 'feast')).toBe(true);
});
it('enforces real session membership, ignores claimed roles, and rechecks revocation', async () => {
  const host = await get('/api/me');
  const hostCookie = host.headers.get('set-cookie')!.split(';')[0];
  const created = await SELF.fetch('https://table.test/api/campaigns', { method: 'POST', headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' }, body: JSON.stringify({ name: '日历权限测试' }) });
  expect(created.status).toBe(201);
  const { campaign } = await created.json() as any;
  const path = `/api/calendar?campaign=${campaign.slug}`;
  const response = await get(path, hostCookie);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ canManage: true, events: expect.arrayContaining([expect.objectContaining({ id: 'feast' })]) });
  const visitor = await get('/api/me');
  const visitorCookie = visitor.headers.get('set-cookie')!.split(';')[0];
  const user = await visitor.json() as any;
  expect((await get(path + '&role=host', visitorCookie)).status).toBe(404);
  await env.DB.prepare("INSERT INTO campaign_members (id,campaign_id,user_id,role,status,joined_at) VALUES (?1,?2,?3,'player','active',?4)").bind(crypto.randomUUID(), campaign.id, user.id, Date.now()).run();
  const player = await (await get(path + '&role=host&canManage=true', visitorCookie)).json() as any;
  expect(player.canManage).toBe(false);
  expect(player.events.some((e: any) => e.id === 'feast')).toBe(false);
  await env.DB.prepare("UPDATE campaign_members SET role='player' WHERE campaign_id=?1").bind(campaign.id).run();
  expect(await (await get(path, hostCookie)).json()).toMatchObject({ canManage: false });
  expect(await (await get('/api/calendar?role=host')).json()).toMatchObject({ canManage: false });
});
