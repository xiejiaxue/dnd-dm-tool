import migration from '../campaign-migrations/0001_campaign_core.sql?raw';
import { SELF, reset, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import presets from '../../shared/waterdeep/deployment.json';
import { MODULES, RESERVED_ROUTE_PATHS, findModuleRoute } from '../src/modules/registry';

describe('module registry', () => {
  it('keeps module ids, library names and route paths unique and clear of the core API', () => {
    const ids = MODULES.map(m => m.id), names = MODULES.map(m => m.library.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain('空白冒险');
    const paths = MODULES.flatMap(m => (m.routes ?? []).map(r => r.path));
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path).toMatch(/^[a-z0-9-]+$/);
      expect(RESERVED_ROUTE_PATHS as readonly string[]).not.toContain(path);
    }
    for (const module of MODULES) expect(module.scenes.count).toBeGreaterThan(0);
  });
  it('matches a route only with its declared shape and methods', () => {
    expect(findModuleRoute('strahd-scene', true, 'GET')?.path).toBe('strahd-scene');
    expect(findModuleRoute('strahd-scene', false, 'GET')).toBeUndefined();
    expect(findModuleRoute('strahd-scene', true, 'DELETE')).toBeUndefined();
    expect(findModuleRoute('waterdeep-deployment', false, 'POST')?.path).toBe('waterdeep-deployment');
    expect(findModuleRoute('waterdeep-deployment', true, 'POST')).toBeUndefined();
    expect(findModuleRoute('scenes', false, 'GET')).toBeUndefined();
  });
});

const base = 'https://table.test';
const call = (path: string, cookie: string, method = 'GET', body?: unknown) => SELF.fetch(base + path, {
  method, headers: { cookie, origin: base, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const visitor = async () => (await call('/api/me', '')).headers.get('set-cookie')!.split(';')[0];
beforeEach(async () => {
  for (const sql of migration.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n').split(';').filter(s => s.trim()))
    await env.DB.prepare(sql).run();
});
afterEach(async () => { await reset(); });

describe('module routes through the Worker and Durable Object', () => {
  it('previews and applies the Waterdeep deployment once, for moderators only', async () => {
    const dm = await visitor();
    const created = await call('/api/campaigns', dm, 'POST', {});
    expect(created.status).toBe(201);
    const { slug } = ((await created.json()) as any).campaign;
    const preset = presets[0];
    expect((await call(`/api/campaigns/${slug}/scenes`, dm, 'POST', { name: preset.match })).status).toBe(201);
    const route = `/api/campaigns/${slug}/waterdeep-deployment`;

    const preview = (await (await call(route, dm)).json()) as any;
    expect(preview.applied).toBe(false);
    expect(preview.rows.find((r: any) => r.scene === preset.match)?.added).toBe(preset.tokens.length);

    const command = { id: crypto.randomUUID() };
    const applied = (await (await call(route, dm, 'POST', command)).json()) as any;
    expect(applied).toMatchObject({ applied: true, added: preset.tokens.length });
    // A replayed command returns the original receipt, and a fresh one finds nothing left to add.
    expect(await (await call(route, dm, 'POST', command)).json()).toEqual(applied);
    expect(((await (await call(route, dm, 'POST', { id: crypto.randomUUID() })).json()) as any).added).toBe(0);

    const invite = await call(`/api/campaigns/${slug}/invites`, dm, 'POST', { role: 'spectator' });
    const token = new URL(((await invite.json()) as any).inviteUrl, base).hash.slice(8);
    const spectator = await visitor();
    expect((await call('/api/invites/redeem', spectator, 'POST', { token })).status).toBe(200);
    expect((await call(route, spectator)).status).toBe(403);
    expect((await call(route, spectator, 'POST', { id: crypto.randomUUID() })).status).toBe(403);
  });
  it('returns 404 for a module route with the wrong shape or method', async () => {
    const dm = await visitor();
    const { slug } = ((await (await call('/api/campaigns', dm, 'POST', {})).json()) as any).campaign;
    expect((await call(`/api/campaigns/${slug}/strahd-scene`, dm)).status).toBe(404);
    expect((await call(`/api/campaigns/${slug}/waterdeep-deployment`, dm, 'DELETE')).status).toBe(404);
  });
});
