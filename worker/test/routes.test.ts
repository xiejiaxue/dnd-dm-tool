import migration from '../campaign-migrations/0001_campaign_core.sql?raw';
import { SELF, reset, env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { API_ROUTES, CAMPAIGN_ROUTES } from '../src/routes';

const base = 'https://table.test';
const call = (path: string, cookie: string, method = 'GET', body?: unknown) => SELF.fetch(base + path, {
  method, headers: { cookie, origin: base, 'content-type': 'application/json' },
  ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }),
});
const visitor = async () => (await call('/api/me', '')).headers.get('set-cookie')!.split(';')[0];
beforeEach(async () => {
  for (const sql of migration.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n').split(';').filter(s => s.trim()))
    await env.DB.prepare(sql).run();
});
afterEach(async () => { await reset(); });

/** Status and error code for each request, so any routing change shows up as a diff. */
async function outcome(response: Response): Promise<string> {
  const text = await response.text();
  let code = '';
  try { code = (JSON.parse(text) as any)?.error?.code ?? ''; } catch { /* not JSON */ }
  return `${response.status}${code ? ` ${code}` : ''}`;
}

it('never lists the same method and path twice, so no route shadows another', () => {
  for (const table of [API_ROUTES, CAMPAIGN_ROUTES]) {
    const keys = table.flatMap(route => (route.methods === '*' ? ['*'] : route.methods).map(method => `${method} ${route.path.replace(/:[^/]+/gu, ':')}`));
    expect(new Set(keys).size).toBe(keys.length);
  }
});

it('routes every endpoint, wrong method and unknown path to the same outcome', async () => {
  const dm = await visitor(), outsider = await visitor(), spectator = await visitor();
  const { slug } = ((await (await call('/api/campaigns', dm, 'POST', {})).json()) as any).campaign;
  const invite = await call(`/api/campaigns/${slug}/invites`, dm, 'POST', { role: 'spectator' });
  const token = new URL(((await invite.json()) as any).inviteUrl, base).hash.slice(8);
  const c = `/api/campaigns/${slug}`;
  const requests: [string, string, string, unknown?][] = [
    [dm, 'GET', '/api/me'], [dm, 'GET', '/api/calendar'], [dm, 'GET', `/api/calendar?campaign=${slug}`],
    [outsider, 'GET', `/api/calendar?campaign=${slug}`],
    [dm, 'GET', '/api/search?q=goblin'], [dm, 'GET', '/api/search'], [dm, 'POST', '/api/search', {}],
    [dm, 'GET', '/api/search/online'], [dm, 'GET', '/api/search/online?q=goblin&type=nope'],
    [dm, 'GET', '/api/entry/monster/nope'], [dm, 'GET', '/api/entry/nope/nope'], [dm, 'GET', '/api/entry/monster'],
    [dm, 'GET', '/api/token/MM__Goblin'], [dm, 'GET', '/api/token'],
    [dm, 'POST', '/api/invites', {}], [dm, 'GET', '/api/invites/redeem'], [dm, 'POST', '/api/invites/redeem', {}],
    [spectator, 'POST', '/api/invites/redeem', { token }],
    [dm, 'GET', '/api/modules'], [dm, 'GET', '/api/campaigns'], [dm, 'GET', '/api/campaigns?status=archived'],
    [dm, 'DELETE', '/api/campaigns', {}], [dm, 'GET', '/api/nope'], [dm, 'GET', '/api'],
    [dm, 'GET', c], [dm, 'POST', c, {}], [dm, 'GET', `${c}/nope`], [dm, 'GET', `${c}/scenes/a/b`],
    [outsider, 'GET', c], [outsider, 'GET', `${c}/nope`], [outsider, 'POST', `${c}/archive`, {}], [outsider, 'DELETE', c, {}],
    [dm, 'GET', `/api/campaigns/no-such-campaign`], [dm, 'GET', `/api/campaigns/no-such-campaign/nope`],
    [dm, 'GET', `${c}/members`], [dm, 'POST', `${c}/members`, {}], [dm, 'DELETE', `${c}/members/nope`, {}],
    [dm, 'GET', `${c}/ws`], [dm, 'GET', `${c}/invites`], [dm, 'POST', `${c}/invites`, { role: 'dm' }],
    [dm, 'GET', `${c}/assets`], [dm, 'GET', `${c}/assets/nope`], [dm, 'DELETE', `${c}/assets/nope`, {}],
    [dm, 'GET', `${c}/scenes`], [dm, 'POST', `${c}/scenes`, { name: '新场景' }], [dm, 'GET', `${c}/scenes/nope`],
    [dm, 'DELETE', `${c}/scenes/nope`, {}], [dm, 'PUT', `${c}/scenes`, {}],
    [dm, 'GET', `${c}/strahd-scene/nope`], [dm, 'GET', `${c}/strahd-scene`], [dm, 'DELETE', `${c}/strahd-scene/nope`, {}],
    [dm, 'GET', `${c}/waterdeep-deployment`], [dm, 'GET', `${c}/waterdeep-deployment/x`],
    [dm, 'GET', `${c}/journals`], [dm, 'POST', `${c}/journals`, { title: '第一天' }], [dm, 'POST', `${c}/journals/nope`, { title: 'x' }],
    [dm, 'DELETE', `${c}/journals`, {}],
    [dm, 'GET', `${c}/character-sheet`], [dm, 'POST', `${c}/character-sheet/entries`, {}], [dm, 'DELETE', `${c}/character-sheet/entries/nope`, {}],
    [dm, 'GET', `${c}/characters`], [dm, 'POST', `${c}/characters`, {}], [dm, 'POST', `${c}/characters/nope/select`, { campaignId: 'x' }],
    [spectator, 'GET', c], [spectator, 'GET', `${c}/waterdeep-deployment`], [spectator, 'POST', `${c}/scenes`, { name: 'x' }],
    [spectator, 'POST', `${c}/archive`, {}], [spectator, 'GET', `${c}/members`],
    [dm, 'GET', `${c}/archive`], [dm, 'PUT', `${c}/restore`, {}], [dm, 'GET', `${c}/archive/x`],
    [dm, 'POST', `${c}/archive`, {}], [dm, 'POST', `${c}/restore`, {}],
    // DELETE only deletes at the campaign root; on the status paths it is a wrong method.
    [dm, 'DELETE', `${c}/restore`, {}], [dm, 'DELETE', `${c}/archive`, {}], [dm, 'GET', c],
    [dm, 'DELETE', c, {}], [dm, 'GET', c], [dm, 'POST', '/api/auth/logout', {}], [dm, 'GET', '/api/auth/logout'],
  ];
  const results: string[] = [];
  for (const [cookie, method, path, body] of requests) {
    const who = cookie === dm ? 'dm' : cookie === outsider ? 'outsider' : 'spectator';
    results.push(`${who} ${method} ${path.replace(slug, ':slug')} -> ${await outcome(await call(path, cookie, method, body))}`);
  }
  expect(results).toEqual(EXPECTED);
});

// Recorded from the hand-written router this table replaced; any difference is a behaviour change.
// Since then only DELETE on /archive and /restore changed, from deleting the campaign to 405.
const EXPECTED: string[] = [
  'dm GET /api/me -> 200',
  'dm GET /api/calendar -> 200',
  'dm GET /api/calendar?campaign=:slug -> 200',
  'outsider GET /api/calendar?campaign=:slug -> 404 CAMPAIGN_NOT_FOUND',
  'dm GET /api/search?q=goblin -> 200',
  'dm GET /api/search -> 200',
  'dm POST /api/search -> 404 NOT_FOUND',
  'dm GET /api/search/online -> 200',
  'dm GET /api/search/online?q=goblin&type=nope -> 400 INVALID_INPUT',
  'dm GET /api/entry/monster/nope -> 404 NOT_FOUND',
  'dm GET /api/entry/nope/nope -> 404 NOT_FOUND',
  'dm GET /api/entry/monster -> 404 NOT_FOUND',
  'dm GET /api/token/MM__Goblin -> 200',
  'dm GET /api/token -> 404 NOT_FOUND',
  'dm POST /api/invites -> 404 NOT_FOUND',
  'dm GET /api/invites/redeem -> 404 NOT_FOUND',
  'dm POST /api/invites/redeem -> 400 INVALID_INPUT',
  'spectator POST /api/invites/redeem -> 200',
  'dm GET /api/modules -> 200',
  'dm GET /api/campaigns -> 200',
  'dm GET /api/campaigns?status=archived -> 200',
  'dm DELETE /api/campaigns -> 404 NOT_FOUND',
  'dm GET /api/nope -> 404 NOT_FOUND',
  'dm GET /api -> 404',
  'dm GET /api/campaigns/:slug -> 200',
  'dm POST /api/campaigns/:slug -> 404 NOT_FOUND',
  'dm GET /api/campaigns/:slug/nope -> 404 NOT_FOUND',
  'dm GET /api/campaigns/:slug/scenes/a/b -> 404 NOT_FOUND',
  'outsider GET /api/campaigns/:slug -> 404 CAMPAIGN_NOT_FOUND',
  'outsider GET /api/campaigns/:slug/nope -> 404 CAMPAIGN_NOT_FOUND',
  'outsider POST /api/campaigns/:slug/archive -> 404 CAMPAIGN_NOT_FOUND',
  'outsider DELETE /api/campaigns/:slug -> 404 CAMPAIGN_NOT_FOUND',
  'dm GET /api/campaigns/no-such-campaign -> 404 CAMPAIGN_NOT_FOUND',
  'dm GET /api/campaigns/no-such-campaign/nope -> 404 CAMPAIGN_NOT_FOUND',
  'dm GET /api/campaigns/:slug/members -> 200',
  'dm POST /api/campaigns/:slug/members -> 404 NOT_FOUND',
  'dm DELETE /api/campaigns/:slug/members/nope -> 404 MEMBER_NOT_FOUND',
  'dm GET /api/campaigns/:slug/ws -> 426 UPGRADE_REQUIRED',
  'dm GET /api/campaigns/:slug/invites -> 404 NOT_FOUND',
  'dm POST /api/campaigns/:slug/invites -> 400 INVALID_INPUT',
  'dm GET /api/campaigns/:slug/assets -> 404 NOT_FOUND',
  'dm GET /api/campaigns/:slug/assets/nope -> 404 ASSET_NOT_FOUND',
  'dm DELETE /api/campaigns/:slug/assets/nope -> 404 NOT_FOUND',
  'dm GET /api/campaigns/:slug/scenes -> 200',
  'dm POST /api/campaigns/:slug/scenes -> 201',
  'dm GET /api/campaigns/:slug/scenes/nope -> 404 NOT_FOUND',
  'dm DELETE /api/campaigns/:slug/scenes/nope -> 400 INVALID',
  'dm PUT /api/campaigns/:slug/scenes -> 404 NOT_FOUND',
  'dm GET /api/campaigns/:slug/strahd-scene/nope -> 404',
  'dm GET /api/campaigns/:slug/strahd-scene -> 404 NOT_FOUND',
  'dm DELETE /api/campaigns/:slug/strahd-scene/nope -> 404 NOT_FOUND',
  'dm GET /api/campaigns/:slug/waterdeep-deployment -> 200',
  'dm GET /api/campaigns/:slug/waterdeep-deployment/x -> 404 NOT_FOUND',
  'dm GET /api/campaigns/:slug/journals -> 200',
  'dm POST /api/campaigns/:slug/journals -> 201',
  'dm POST /api/campaigns/:slug/journals/nope -> 404 JOURNAL_NOT_FOUND',
  'dm DELETE /api/campaigns/:slug/journals -> 404 NOT_FOUND',
  'dm GET /api/campaigns/:slug/character-sheet -> 404 CHARACTER_NOT_SELECTED',
  'dm POST /api/campaigns/:slug/character-sheet/entries -> 400 INVALID_INPUT',
  'dm DELETE /api/campaigns/:slug/character-sheet/entries/nope -> 403 FORBIDDEN',
  'dm GET /api/campaigns/:slug/characters -> 200',
  'dm POST /api/campaigns/:slug/characters -> 400 INVALID_INPUT',
  'dm POST /api/campaigns/:slug/characters/nope/select -> 404 CAMPAIGN_NOT_FOUND',
  'spectator GET /api/campaigns/:slug -> 200',
  'spectator GET /api/campaigns/:slug/waterdeep-deployment -> 403 FORBIDDEN',
  'spectator POST /api/campaigns/:slug/scenes -> 403 FORBIDDEN',
  'spectator POST /api/campaigns/:slug/archive -> 403 FORBIDDEN',
  'spectator GET /api/campaigns/:slug/members -> 403 FORBIDDEN',
  'dm GET /api/campaigns/:slug/archive -> 405 METHOD_NOT_ALLOWED',
  'dm PUT /api/campaigns/:slug/restore -> 405 METHOD_NOT_ALLOWED',
  'dm GET /api/campaigns/:slug/archive/x -> 404 NOT_FOUND',
  'dm POST /api/campaigns/:slug/archive -> 200',
  'dm POST /api/campaigns/:slug/restore -> 200',
  'dm DELETE /api/campaigns/:slug/restore -> 405 METHOD_NOT_ALLOWED',
  'dm DELETE /api/campaigns/:slug/archive -> 405 METHOD_NOT_ALLOWED',
  'dm GET /api/campaigns/:slug -> 200',
  'dm DELETE /api/campaigns/:slug -> 200',
  'dm GET /api/campaigns/:slug -> 404 CAMPAIGN_NOT_FOUND',
  'dm POST /api/auth/logout -> 200',
  'dm GET /api/auth/logout -> 404 NOT_FOUND',
];
