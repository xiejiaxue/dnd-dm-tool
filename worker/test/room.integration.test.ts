import { env } from 'cloudflare:workers';
import { SELF, reset } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import controlPlaneMigration from '../migrations/0001_control_plane.sql?raw';
import campaignSavesMigration from '../migrations/0002_campaign_saves.sql?raw';

// D1Database#exec accepts a multi-statement script but its local parser does
// not accept a leading comment-only statement. Wrangler's migration command
// does; removing comments here keeps this an integration test of the exact SQL.
const migrationSql = `${controlPlaneMigration}\n${campaignSavesMigration}`
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n');
const migrationStatements = migrationSql.split(';').map(statement => statement.trim()).filter(Boolean);

interface RoomResponse {
  room: { id: string; slug: string; name: string; role: string };
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://table.test${path}`, init);
}

function sessionCookie(response: Response): string {
  const raw = response.headers.get('set-cookie');
  if (!raw) throw new Error('expected a session cookie');
  return raw.split(';', 1)[0];
}

beforeEach(async () => {
  for (const statement of migrationStatements) await env.DB.prepare(statement).run();
});

afterEach(async () => {
  await reset();
});

describe('Cloudflare room control plane', () => {
  it('returns an empty public config without creating a visitor session', async () => {
    const response = await api('/api/public-config');
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({});
  });

  it('creates an isolated room, initializes its Durable Object, and persists a scene mutation', async () => {
    const me = await api('/api/me');
    expect(me.status).toBe(200);
    const hostCookie = sessionCookie(me);

    const created = await api('/api/rooms', {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ roomName: 'Friday table' }),
    });
    expect(created.status).toBe(201);
    const { room } = await created.json() as RoomResponse;
    expect(room.slug).toMatch(/^friday-table-/u);
    expect(room.role).toBe('host');

    const bootstrap = await api(`/api/rooms/${room.slug}`, { headers: { cookie: hostCookie } });
    expect(bootstrap.status).toBe(200);
    const bootstrapBody = await bootstrap.json() as { state: { type: string; revision: number; role: string } };
    expect(bootstrapBody.state).toMatchObject({ type: 'state', revision: 0, role: 'dm' });

    const scene = await api(`/api/rooms/${room.slug}/scenes`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'The crypt' }),
    });
    expect(scene.status).toBe(201);
    const sceneBody = await scene.json() as { id: string; name: string };
    expect(sceneBody.name).toBe('The crypt');

    const afterMutation = await api(`/api/rooms/${room.slug}`, { headers: { cookie: hostCookie } });
    const afterBody = await afterMutation.json() as { state: { revision: number; campaign: { sceneIds: string[] } } };
    expect(afterBody.state.revision).toBe(1);
    expect(afterBody.state.campaign.sceneIds).toContain(sceneBody.id);
  });

  it('uses a fragment token as a one-time player invitation without exposing a room before redemption', async () => {
    const hostMe = await api('/api/me');
    const hostCookie = sessionCookie(hostMe);
    const created = await api('/api/rooms', {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ roomName: 'Invite table' }),
    });
    const { room } = await created.json() as RoomResponse;

    const inviteResponse = await api(`/api/rooms/${room.slug}/invites`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' }),
    });
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json() as { inviteUrl: string };
    const token = new URL(`https://table.test${invite.inviteUrl}`).hash.replace('#invite=', '');
    expect(token.length).toBeGreaterThan(30);

    const playerMe = await api('/api/me');
    const playerCookie = sessionCookie(playerMe);
    const before = await api(`/api/rooms/${room.slug}`, { headers: { cookie: playerCookie } });
    expect(before.status).toBe(404);

    const redemption = await api('/api/invites/redeem', {
      method: 'POST',
      headers: { cookie: playerCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(redemption.status).toBe(200);
    expect(await redemption.json()).toEqual({ roomSlug: room.slug });

    const joined = await api(`/api/rooms/${room.slug}`, { headers: { cookie: playerCookie } });
    expect(joined.status).toBe(200);
    const joinedBody = await joined.json() as { membership: { role: string }; state: { role: string; campaign: { enemies: unknown[] } } };
    expect(joinedBody.membership.role).toBe('player');
    expect(joinedBody.state.role).toBe('player');
    expect(joinedBody.state.campaign.enemies).toEqual([]);
  });

  it('creates and resumes isolated campaign saves with campaign-owned characters', async () => {
    const me = await api('/api/me');
    const cookie = sessionCookie(me);
    const headers = { cookie, origin: 'https://table.test', 'content-type': 'application/json' };
    const created = await api('/api/rooms', { method: 'POST', headers, body: JSON.stringify({ roomName: 'Save table' }) });
    const { room } = await created.json() as RoomResponse;
    const initial = await api(`/api/rooms/${room.slug}`, { headers: { cookie } });
    const initialBody = await initial.json() as { modules: { id: string }[]; campaigns: unknown[]; activeCampaign: unknown };
    expect(initialBody.modules).toHaveLength(1);
    expect(initialBody.campaigns).toEqual([]);
    expect(initialBody.activeCampaign).toBeNull();

    const save = await api(`/api/rooms/${room.slug}/campaigns`, {
      method: 'POST', headers, body: JSON.stringify({ name: '失落矿坑', moduleId: initialBody.modules[0].id }),
    });
    expect(save.status).toBe(201);
    const saveBody = await save.json() as { id: string };
    const selected = await api(`/api/rooms/${room.slug}/campaigns/${saveBody.id}/select`, { method: 'POST', headers });
    expect(selected.status).toBe(200);

    const character = await api(`/api/rooms/${room.slug}/characters`, {
      method: 'POST', headers, body: JSON.stringify({ campaignId: saveBody.id, name: '莱拉', color: '#112233', maxHp: 18 }),
    });
    expect(character.status).toBe(201);
    const characterBody = await character.json() as { id: string; maxHp: number };
    expect(characterBody.maxHp).toBe(18);
    const picked = await api(`/api/rooms/${room.slug}/characters/${characterBody.id}/select`, {
      method: 'POST', headers, body: JSON.stringify({ campaignId: saveBody.id }),
    });
    expect(picked.status).toBe(200);
    const resumed = await api(`/api/rooms/${room.slug}`, { headers: { cookie } });
    const resumedBody = await resumed.json() as { activeCampaign: { id: string }; selectedCharacter: { name: string } };
    expect(resumedBody.activeCampaign.id).toBe(saveBody.id);
    expect(resumedBody.selectedCharacter.name).toBe('莱拉');
  });
});
