import { env } from 'cloudflare:workers';
import { SELF, reset } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import controlPlaneMigration from '../migrations/0001_control_plane.sql?raw';
import persistentInviteMigration from '../migrations/0002_persistent_room_invite_codes.sql?raw';
import platformRolesMigration from '../migrations/0003_platform_roles.sql?raw';
import worldDocumentsMigration from '../migrations/0004_world_documents.sql?raw';
import tabletopToolsMigration from '../migrations/0005_tabletop_tools.sql?raw';
import { callRoom, requireRoomAccess } from '../src/repository';

// D1Database#exec accepts a multi-statement script but its local parser does
// not accept a leading comment-only statement. Wrangler's migration command
// does; removing comments here keeps this an integration test of the exact SQL.
const migrationSql = [controlPlaneMigration, persistentInviteMigration, platformRolesMigration, worldDocumentsMigration, tabletopToolsMigration]
  .map(migration => migration
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n'))
  .join('\n');
const migrationStatements = migrationSql.split(';').map(statement => statement.trim()).filter(Boolean);

interface RoomResponse {
  room: { id: string; slug: string; name: string; role: string };
}

const tinyPng = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2JwAAAABJRU5ErkJggg=='
), char => char.charCodeAt(0));
const tinyWebp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
]);

const roomTemplateSummary = {
  id: 'waterdeep-dragon-heist',
  name: '深水城：龙金劫',
  description: '测试模板',
  version: 1,
  sceneCount: 2,
  npcCount: 1,
};

async function putRoomTemplate(): Promise<void> {
  await env.REFERENCE_DATA.put('room-templates/index.json', JSON.stringify({
    schemaVersion: 1,
    templates: [roomTemplateSummary],
  }));
  await env.REFERENCE_DATA.put('room-templates/waterdeep-dragon-heist/manifest.json', JSON.stringify({
    schemaVersion: 1,
    ...roomTemplateSummary,
    scenes: [
      {
        key: 'scene-001', name: '第一章 · 入口', chapter: '第一章', unlocked: true,
        map: { assetId: 'map-001', width: 1200, height: 800, contentType: 'image/png', mapScale: 3 },
        tokens: [{
          key: 'template-token-001', kind: 'npc', name: '珊娜萨', entryId: 'npc:npc-xanathar',
          x: 100, y: 200, size: 100, avatar: '/api/token/MM__Beholder', color: '#8b5cf6',
          number: 1, hp: { current: 180, max: 180 },
        }],
      },
      {
        key: 'scene-002', name: '第二章 · 巨魔颅巷', chapter: '第二章', unlocked: false,
        map: { assetId: 'map-002', width: 900, height: 1400, contentType: 'image/png', mapScale: 3 },
      },
    ],
    npcs: [{
      id: 'npc-xanathar', name: '珊娜萨', aliases: ['XANATHAR'], role: '散塔林会', location: '',
      status: 'active', notesMarkdown: '观察者是一只眼魔。', sourceFile: '散塔林会/珊娜萨.md', updatedAt: 0,
    }],
  }));
  await Promise.all(['map-001', 'map-002'].map(assetId => env.REFERENCE_DATA.put(
    `room-templates/waterdeep-dragon-heist/assets/${assetId}`,
    tinyPng,
    { httpMetadata: { contentType: 'image/png' } },
  )));
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

  it('stores personal character cards independently and only lets room players import them', async () => {
    const hostMe = await api('/api/me');
    const hostCookie = sessionCookie(hostMe);
    const headers = { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' };

    const rules = await api('/api/plugins/dnd5e-character-sheet/rules', { headers: { cookie: hostCookie } });
    expect(rules.status).toBe(200);
    expect(await rules.json()).toMatchObject({
      schemaVersion: 1,
      sourceUrl: 'https://5echm.kagangtuya.top/',
      sources: expect.arrayContaining([expect.objectContaining({ id: 'PHB', core: true })]),
      options: expect.arrayContaining([expect.objectContaining({ kind: 'class', source: 'PHB' })]),
    });

    const hostCharacter = await api('/api/plugins/dnd5e-character-sheet/characters', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '房主的私人角色', sheet: { identity: { characterName: '房主的私人角色' } } }),
    });
    expect(hostCharacter.status).toBe(201);
    const hostCharacterBody = await hostCharacter.json() as { id: string };

    const created = await api('/api/rooms', {
      method: 'POST', headers, body: JSON.stringify({ roomName: 'Character plugin room' }),
    });
    const { room } = await created.json() as RoomResponse;
    const hostRoomPlugin = await api(`/api/rooms/${room.slug}/plugins/dnd5e-character-sheet/characters`, {
      headers: { cookie: hostCookie },
    });
    expect(hostRoomPlugin.status).toBe(403);
    expect(await hostRoomPlugin.json()).toMatchObject({ error: { code: 'PLAYER_ONLY' } });

    const playerMe = await api('/api/me');
    const playerCookie = sessionCookie(playerMe);
    expect(await (await api('/api/plugins/dnd5e-character-sheet/characters', { headers: { cookie: playerCookie } })).json()).toEqual({ characters: [] });
    const inviteResponse = await api(`/api/rooms/${room.slug}/invites`, {
      method: 'POST', headers, body: JSON.stringify({ role: 'player' }),
    });
    const invite = await inviteResponse.json() as { inviteCode: string };
    await api('/api/invites/redeem', {
      method: 'POST',
      headers: { cookie: playerCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ token: invite.inviteCode }),
    });

    const playerCharacterResponse = await api('/api/plugins/dnd5e-character-sheet/characters', {
      method: 'POST',
      headers: { cookie: playerCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '玩家游侠', color: '#123abc',
        sheet: {
          rules: { enabledSources: ['PHB', 'XGE'] },
          identity: { characterName: '玩家游侠', playerName: '测试玩家' },
          advancement: { level: 5 },
          combat: { armorClass: 16, speed: 30, hitPoints: { current: 42, max: 42, temporary: 0 } },
          abilities: { str: 10, dex: 18, con: 14, int: 10, wis: 15, cha: 8 },
          feats: [{ id: 'feat:XGE:Elven Accuracy', kind: 'feat', name: '精灵精准', nameEn: 'Elven Accuracy', source: 'XGE' }],
        },
      }),
    });
    expect(playerCharacterResponse.status).toBe(201);
    const playerCharacter = await playerCharacterResponse.json() as { id: string };

    const roomCards = await api(`/api/rooms/${room.slug}/plugins/dnd5e-character-sheet/characters`, { headers: { cookie: playerCookie } });
    expect(await roomCards.json()).toMatchObject({ characters: [expect.objectContaining({ id: playerCharacter.id, name: '玩家游侠' })] });
    const imported = await api(`/api/rooms/${room.slug}/plugins/dnd5e-character-sheet/characters/${playerCharacter.id}/import`, {
      method: 'POST', headers: { cookie: playerCookie, origin: 'https://table.test' },
    });
    expect(imported.status).toBe(201);
    const importedBody = await imported.json() as { actorId: string; characterId: string };
    expect(importedBody.characterId).toBe(playerCharacter.id);
    const actors = await api(`/api/rooms/${room.slug}/actors`, { headers: { cookie: playerCookie } });
    expect(await actors.json()).toMatchObject({
      actors: [expect.objectContaining({ id: importedBody.actorId, name: '玩家游侠', system: expect.objectContaining({ level: 5, armorClass: 16 }) })],
      claim: expect.objectContaining({ actorId: importedBody.actorId }),
    });

    expect((await api(`/api/plugins/dnd5e-character-sheet/characters/${hostCharacterBody.id}`, {
      method: 'DELETE', headers,
    })).status).toBe(200);
    expect(await (await api('/api/plugins/dnd5e-character-sheet/characters', { headers: { cookie: hostCookie } })).json()).toEqual({ characters: [] });
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

  it('lets the platform owner inspect every room and perform explicit room cleanup without general mutation rights', async () => {
    await putRoomTemplate();
    const hostMe = await api('/api/me');
    const hostCookie = sessionCookie(hostMe);
    const created = await api('/api/rooms', {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ roomName: 'Other host room', templateId: roomTemplateSummary.id }),
    });
    const { room } = await created.json() as RoomResponse;

    const ownerMe = await api('/api/me');
    const ownerCookie = sessionCookie(ownerMe);
    const ownerIdentity = await ownerMe.json() as { id: string };
    await env.DB.prepare(
      `INSERT INTO platform_roles (user_id, role, granted_at) VALUES (?1, 'owner', ?2)`,
    ).bind(ownerIdentity.id, Date.now()).run();

    const refreshedIdentity = await api('/api/me', { headers: { cookie: ownerCookie } });
    expect(await refreshedIdentity.json()).toMatchObject({
      id: ownerIdentity.id, platformRole: 'owner', canReadAllRooms: true,
    });

    const listed = await api('/api/rooms', { headers: { cookie: ownerCookie } });
    const listBody = await listed.json() as { rooms: Array<{ slug: string; role: string; platformReadOnly?: boolean }> };
    expect(listBody.rooms).toContainEqual(expect.objectContaining({
      slug: room.slug, role: 'spectator', platformReadOnly: true,
    }));

    const bootstrap = await api(`/api/rooms/${room.slug}`, { headers: { cookie: ownerCookie } });
    expect(bootstrap.status).toBe(200);
    const body = await bootstrap.json() as {
      room: { platformReadOnly?: boolean };
      membership: { role: string; canManage: boolean; canReadAll: boolean };
      state: { role: string; viewer: { canManage: boolean; canReadAll: boolean }; campaign: { npcs: unknown[] } };
    };
    expect(body.room.platformReadOnly).toBe(true);
    expect(body.membership).toMatchObject({ role: 'spectator', canManage: false, canReadAll: true });
    expect(body.state).toMatchObject({ role: 'player', viewer: { canManage: false, canReadAll: true } });
    expect(body.state.campaign.npcs).toHaveLength(1);

    const scenes = await api(`/api/rooms/${room.slug}/scenes`, { headers: { cookie: ownerCookie } });
    const sceneList = await scenes.json() as Array<{ id: string; unlocked: boolean }>;
    expect(sceneList).toHaveLength(2);
    expect(sceneList.some(scene => scene.unlocked === false)).toBe(true);
    const locked = sceneList.find(scene => !scene.unlocked);
    expect(locked).toBeDefined();
    expect((await api(`/api/rooms/${room.slug}/scenes/${locked!.id}`, { headers: { cookie: ownerCookie } })).status).toBe(200);

    const mutation = await api(`/api/rooms/${room.slug}/scenes`, {
      method: 'POST',
      headers: { cookie: ownerCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Must not be created' }),
    });
    expect(mutation.status).toBe(403);
    const cleanup = await api(`/api/rooms/${room.slug}`, {
      method: 'DELETE', headers: { cookie: ownerCookie, origin: 'https://table.test' },
    });
    expect(cleanup.status).toBe(200);
    expect(await cleanup.json()).toEqual({ ok: true });
    expect((await api(`/api/rooms/${room.slug}`, { headers: { cookie: ownerCookie } })).status).toBe(404);
  });

  it('lists templates and clones independent Dragon Heist rooms with protected shared maps', async () => {
    await putRoomTemplate();
    const me = await api('/api/me');
    const hostCookie = sessionCookie(me);

    const listed = await api('/api/room-templates', { headers: { cookie: hostCookie } });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ templates: [roomTemplateSummary] });

    const createFromTemplate = (roomName: string) => api('/api/rooms', {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ roomName, templateId: roomTemplateSummary.id }),
    });
    const firstCreated = await createFromTemplate('龙金劫 A 团');
    const secondCreated = await createFromTemplate('龙金劫 B 团');
    expect(firstCreated.status).toBe(201);
    expect(secondCreated.status).toBe(201);
    const first = (await firstCreated.json() as RoomResponse).room;
    const second = (await secondCreated.json() as RoomResponse).room;

    const firstBootstrap = await api(`/api/rooms/${first.slug}`, { headers: { cookie: hostCookie } });
    const secondBootstrap = await api(`/api/rooms/${second.slug}`, { headers: { cookie: hostCookie } });
    const firstState = (await firstBootstrap.json() as {
      state: { scene: { id: string; mapImage: string; mapSize: number[]; mapScale: number; fogReveals: unknown[]; tokens: { id: string; name: string; hp?: { current: number; max: number } }[] }; campaign: { name: string; templateId: string; sceneIds: string[]; sceneFolders: { id: string; name: string }[]; sceneFolderAssignments: Record<string, string>; npcs: unknown[] } };
    }).state;
    const secondState = (await secondBootstrap.json() as {
      state: { scene: { id: string; tokens: { id: string }[] }; campaign: { sceneIds: string[]; npcs: unknown[] } };
    }).state;

    expect(firstState.campaign).toMatchObject({ name: '深水城：龙金劫', templateId: roomTemplateSummary.id });
    expect(firstState.campaign.sceneIds).toHaveLength(2);
    expect(firstState.campaign.sceneFolders.map(folder => folder.name)).toEqual(['第一章', '第二章']);
    expect(firstState.campaign.sceneFolderAssignments[firstState.campaign.sceneIds[0]]).toBe(firstState.campaign.sceneFolders[0].id);
    expect(firstState.campaign.sceneFolderAssignments[firstState.campaign.sceneIds[1]]).toBe(firstState.campaign.sceneFolders[1].id);
    expect(firstState.campaign.npcs).toHaveLength(1);
    expect(firstState.scene).toMatchObject({ mapSize: [1200, 800], mapScale: 3, fogReveals: [] });
    expect(firstState.scene.tokens).toEqual([
      expect.objectContaining({ name: '珊娜萨', hp: { current: 180, max: 180 } }),
    ]);
    expect(firstState.scene.mapImage).toBe(`/api/rooms/${first.slug}/template-assets/${roomTemplateSummary.id}/map-001`);
    expect(secondState.campaign.sceneIds).toHaveLength(2);
    expect(secondState.campaign.npcs).toHaveLength(1);
    expect(secondState.campaign.sceneIds).not.toEqual(firstState.campaign.sceneIds);
    expect(secondState.scene.id).not.toBe(firstState.scene.id);
    expect(secondState.scene.tokens[0].id).not.toBe(firstState.scene.tokens[0].id);

    const sceneCatalog = await api(`/api/rooms/${first.slug}/scenes`, { headers: { cookie: hostCookie } });
    expect(sceneCatalog.status).toBe(200);
    expect(await sceneCatalog.json()).toEqual([
      expect.objectContaining({ id: firstState.campaign.sceneIds[0], mapImage: firstState.scene.mapImage, folderId: firstState.campaign.sceneFolders[0].id }),
      expect.objectContaining({ id: firstState.campaign.sceneIds[1], mapImage: expect.stringContaining('/map-002'), folderId: firstState.campaign.sceneFolders[1].id }),
    ]);

    const map = await api(firstState.scene.mapImage, { headers: { cookie: hostCookie } });
    expect(map.status).toBe(200);
    expect(map.headers.get('content-type')).toBe('image/png');
    expect(map.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await map.arrayBuffer())).toEqual(tinyPng);

    const stranger = await api('/api/me');
    const strangerCookie = sessionCookie(stranger);
    const denied = await api(firstState.scene.mapImage, { headers: { cookie: strangerCookie } });
    expect(denied.status).toBe(404);
  });

  it('uploads a map image, persists it on the active scene, and serves it through the private asset route', async () => {
    const me = await api('/api/me');
    const hostCookie = sessionCookie(me);
    const created = await api('/api/rooms', {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ roomName: 'Map upload table' }),
    });
    const { room } = await created.json() as RoomResponse;

    const form = new FormData();
    form.append('file', new File([tinyPng], 'map.png', { type: 'image/png' }));
    form.append('width', '640');
    form.append('height', '480');
    const uploaded = await api(`/api/rooms/${room.slug}/map`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test' },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const asset = await uploaded.json() as { id: string; url: string };
    expect(asset.url).toBe(`/api/rooms/${room.slug}/assets/${asset.id}`);

    const bootstrap = await api(`/api/rooms/${room.slug}`, { headers: { cookie: hostCookie } });
    const state = await bootstrap.json() as { state: { scene: { mapImage: string | null; mapSize: [number, number] } } };
    expect(state.state.scene.mapImage).toBe(asset.url);
    expect(state.state.scene.mapSize).toEqual([640, 480]);

    const image = await api(asset.url, { headers: { cookie: hostCookie } });
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(image.headers.get('etag')).toBeTruthy();
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(tinyPng);
  });

  it('serves a monster portrait from the private R2 compendium', async () => {
    await env.REFERENCE_DATA.put('compendium/index.json', JSON.stringify([{
      type: 'monster', id: 'MM__Goblin', nameZh: '地精', nameEn: 'Goblin',
      source: 'MM', bookFile: 'bestiary/bestiary-mm.json', hasToken: true,
    }]));
    await env.REFERENCE_DATA.put('compendium/tokens/MM__Goblin.webp', tinyWebp, {
      httpMetadata: { contentType: 'image/webp' },
      customMetadata: { source: '5etools-img' },
    });

    const response = await api('/api/token/MM__Goblin');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(tinyWebp);

    const stored = await env.REFERENCE_DATA.get('compendium/tokens/MM__Goblin.webp');
    expect(stored?.customMetadata).toMatchObject({ source: '5etools-img' });
  });

  it('automatically rolls monster and NPC initiative and upserts rerolls', async () => {
    const me = await api('/api/me');
    const hostCookie = sessionCookie(me);
    const created = await api('/api/rooms', {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ roomName: 'Initiative table' }),
    });
    const { room } = await created.json() as RoomResponse;
    const member = await env.DB.prepare(
      'SELECT user_id FROM room_members WHERE room_id = ?1 AND role = ?2',
    ).bind(room.id, 'host').first<{ user_id: string }>();
    if (!member) throw new Error('expected room host');
    const access = await requireRoomAccess(env, member.user_id, room.slug);

    await env.REFERENCE_DATA.put('compendium/index.json', JSON.stringify([{
      type: 'monster', id: 'MM__Goblin', nameZh: '地精', nameEn: 'Goblin',
      source: 'MM', bookFile: 'bestiary/bestiary-mm.json', initiativeModifier: 2,
    }]));
    const added = await callRoom(env, access, 'POST', '/ops', {
      id: crypto.randomUUID(),
      ops: [
        {
          op: 'upsertNpc',
          npc: {
            id: 'npc-linked', name: '泽姆克', aliases: [], role: '灰矮人守卫', location: '', status: 'active',
            faction: '珊娜萨公会', groupPath: ['珊娜萨公会'],
            statReference: { kind: 'compendium', entryId: 'MM__Goblin', nameZh: '地精', nameEn: 'Goblin' },
            notesMarkdown: '', sourceFile: null, updatedAt: 1,
          },
        },
        {
          op: 'upsertNpc',
          npc: {
            id: 'npc-custom', name: '阿迈戈', aliases: [], role: '管家', location: '', status: 'active',
            faction: '珊娜萨公会', groupPath: ['珊娜萨公会'], statReference: { kind: 'custom' },
            notesMarkdown: '| 护甲等级 | 18 |\n| 生命值 | 143 |\n| 力量/敏捷/体质 | 20（+5）/ 16（+3）/ 14（+2） |',
            sourceFile: null, updatedAt: 1,
          },
        },
        {
          op: 'addToken',
          token: {
            id: 'browser-monster', kind: 'monster', name: '地精', entryId: 'MM__Goblin',
            x: 100, y: 100, size: 100, avatar: '/api/token/MM__Goblin', color: '#fff',
          },
        },
        {
          op: 'addToken',
          token: {
            id: 'browser-linked-npc', kind: 'npc', name: '泽姆克', entryId: 'npc:npc-linked',
            x: 200, y: 100, size: 100, avatar: '/api/token/MM__Goblin', color: '#0ea5e9',
          },
        },
        {
          op: 'addToken',
          token: {
            id: 'browser-custom-npc', kind: 'npc', name: '阿迈戈', entryId: 'npc:npc-custom',
            x: 300, y: 100, size: 100, avatar: '', color: '#0ea5e9',
          },
        },
      ],
    });
    expect(added.status).toBe(200);

    const initiativeSelections = [
      ['browser-monster', 'browser-custom-npc'],
      ['browser-linked-npc'],
    ];
    const expectedModifiers = [[2, 3], [2]];
    for (let attempt = 0; attempt < initiativeSelections.length; attempt += 1) {
      const rolled = await api(`/api/rooms/${room.slug}/initiative/roll`, {
        method: 'POST',
        headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
        body: JSON.stringify({ tokenIds: initiativeSelections[attempt] }),
      });
      expect(rolled.status).toBe(200);
      const body = await rolled.json() as { rolls: { name: string; value: number; modifier: number }[] };
      expect(body.rolls).toHaveLength(initiativeSelections[attempt].length);
      expect(body.rolls.map(result => result.modifier)).toEqual(expectedModifiers[attempt]);
      for (const result of body.rolls) {
        expect(result.value).toBeGreaterThanOrEqual(1 + result.modifier);
        expect(result.value).toBeLessThanOrEqual(20 + result.modifier);
      }
    }

    const advanced = await callRoom(env, access, 'POST', '/ops', {
      id: crypto.randomUUID(),
      ops: [{ op: 'startEncounter' }, { op: 'nextTurn' }, { op: 'nextTurn' }, { op: 'nextTurn' }],
    });
    expect(advanced.status).toBe(200);

    const bootstrap = await api(`/api/rooms/${room.slug}`, { headers: { cookie: hostCookie } });
    const state = await bootstrap.json() as { state: {
      scene: { initiative: { name: string; tokenId: string }[] };
      encounter: { status: string; round: number; turn: number | null; combatants: { name: string; tokenId: string }[] };
    } };
    expect(state.state.scene.initiative).toHaveLength(3);
    expect(state.state.scene.initiative.map(entry => entry.name).sort()).toEqual(['地精 #1', '泽姆克 #1', '阿迈戈 #1'].sort());
    expect(state.state.scene.initiative.every(entry => typeof entry.tokenId === 'string')).toBe(true);
    expect(state.state.encounter).toMatchObject({ status: 'active', round: 2, turn: 0 });
    expect(state.state.encounter.combatants).toHaveLength(3);
  });

  it('keeps one reusable player invite code for a room and lets multiple players redeem it', async () => {
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
    const invite = await inviteResponse.json() as { inviteUrl: string; inviteCode: string; expiresAt: number | null; maxUses: number | null };
    const token = new URL(`https://table.test${invite.inviteUrl}`).hash.replace('#invite=', '');
    expect(invite.inviteCode).toMatch(/^(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-){3}[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/u);
    expect(token).toBe(invite.inviteCode);
    expect(invite.expiresAt).toBeNull();
    expect(invite.maxUses).toBeNull();

    const sameInviteResponse = await api(`/api/rooms/${room.slug}/invites`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' }),
    });
    expect(await sameInviteResponse.json()).toMatchObject({ inviteCode: invite.inviteCode, inviteUrl: invite.inviteUrl });

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

    const secondPlayerMe = await api('/api/me');
    const secondPlayerCookie = sessionCookie(secondPlayerMe);
    const secondRedemption = await api('/api/invites/redeem', {
      method: 'POST',
      headers: { cookie: secondPlayerCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      // Players can enter the code in lower case without the displayed dashes.
      body: JSON.stringify({ token: invite.inviteCode.replaceAll('-', '').toLowerCase() }),
    });
    expect(secondRedemption.status).toBe(200);
    expect(await secondRedemption.json()).toEqual({ roomSlug: room.slug });

    const secondJoined = await api(`/api/rooms/${room.slug}`, { headers: { cookie: secondPlayerCookie } });
    expect(secondJoined.status).toBe(200);
  });

  it('keeps Actors, claims, Journals, MapNotes, and Macros behind one document permission model', async () => {
    const hostMe = await api('/api/me');
    const hostCookie = sessionCookie(hostMe);
    const created = await api('/api/rooms', {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ roomName: 'Document model room' }),
    });
    const { room } = await created.json() as RoomResponse;
    const bootstrap = await api(`/api/rooms/${room.slug}`, { headers: { cookie: hostCookie } });
    const sceneId = (await bootstrap.json() as { state: { scene: { id: string } } }).state.scene.id;

    const actorResponse = await api(`/api/rooms/${room.slug}/actors`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '面团勇士', actorType: 'character',
        ownership: { default: 'owner', users: {} },
      }),
    });
    expect(actorResponse.status).toBe(201);
    const actor = await actorResponse.json() as { id: string };

    const journalResponse = await api(`/api/rooms/${room.slug}/journals`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ name: '玩家手册', ownership: { default: 'observer', users: {} } }),
    });
    const journal = await journalResponse.json() as { id: string };
    const pageResponse = await api(`/api/rooms/${room.slug}/journals/${journal.id}/pages`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ name: '线索', type: 'markdown', text: '港口仓库的门牌号。' }),
    });
    expect(pageResponse.status).toBe(201);
    const page = await pageResponse.json() as { id: string };
    const noteResponse = await api(`/api/rooms/${room.slug}/scenes/${sceneId}/notes`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ journalId: journal.id, pageId: page.id, x: 120, y: 240, label: '仓库', visibility: 'inherit' }),
    });
    expect(noteResponse.status).toBe(201);
    const macroFolderResponse = await api(`/api/rooms/${room.slug}/folders/macro`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ name: '常用检定' }),
    });
    const macroFolder = await macroFolderResponse.json() as { id: string };
    const macroResponse = await api(`/api/rooms/${room.slug}/macros`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '察觉检定', command: { commandId: 'core.dice.roll', args: { formula: '1d20+5' } },
        ownership: { default: 'observer', users: {} }, folderId: macroFolder.id,
      }),
    });
    expect(macroResponse.status).toBe(201);
    const macro = await macroResponse.json() as { id: string; name: string };
    const hostBinding = await api(`/api/rooms/${room.slug}/macros/hotbar/1`, {
      method: 'PATCH',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ macroId: macro.id }),
    });
    expect(hostBinding.status).toBe(200);
    expect(await hostBinding.json()).toMatchObject({ slot: 1, macro: { id: macro.id, name: '察觉检定' } });
    const updatedMacro = await api(`/api/rooms/${room.slug}/macros/${macro.id}`, {
      method: 'PATCH',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ name: '察觉检定（更新）' }),
    });
    expect(await updatedMacro.json()).toMatchObject({ id: macro.id, name: '察觉检定（更新）', folderId: macroFolder.id });

    const inviteResponse = await api(`/api/rooms/${room.slug}/invites`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' }),
    });
    const invite = await inviteResponse.json() as { inviteCode: string };
    const playerMe = await api('/api/me');
    const playerCookie = sessionCookie(playerMe);
    const player = await playerMe.json() as { id: string };
    await api('/api/invites/redeem', {
      method: 'POST',
      headers: { cookie: playerCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ token: invite.inviteCode }),
    });

    const claimed = await api(`/api/rooms/${room.slug}/actors/${actor.id}/claim`, {
      method: 'POST', headers: { cookie: playerCookie, origin: 'https://table.test' },
    });
    expect(claimed.status).toBe(200);
    const access = await requireRoomAccess(env, player.id, room.slug);
    expect(access.claimedActor).toMatchObject({ id: actor.id, name: '面团勇士' });

    const journals = await api(`/api/rooms/${room.slug}/journals`, { headers: { cookie: playerCookie } });
    expect(await journals.json()).toEqual([
      expect.objectContaining({ id: journal.id, pages: [expect.objectContaining({ id: page.id, text: '港口仓库的门牌号。' })] }),
    ]);
    const notes = await api(`/api/rooms/${room.slug}/scenes/${sceneId}/notes`, { headers: { cookie: playerCookie } });
    expect(await notes.json()).toEqual([expect.objectContaining({ journalId: journal.id, pageId: page.id, label: '仓库' })]);
    const macros = await api(`/api/rooms/${room.slug}/macros`, { headers: { cookie: playerCookie } });
    expect(await macros.json()).toEqual([expect.objectContaining({ command: { commandId: 'core.dice.roll', args: { formula: '1d20+5' } } })]);
    expect(await (await api(`/api/rooms/${room.slug}/macros/hotbar`, { headers: { cookie: playerCookie } })).json()).toEqual([]);
    const playerBinding = await api(`/api/rooms/${room.slug}/macros/hotbar/10`, {
      method: 'PATCH',
      headers: { cookie: playerCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ macroId: macro.id }),
    });
    expect(playerBinding.status).toBe(200);
    expect(await (await api(`/api/rooms/${room.slug}/macros/hotbar`, { headers: { cookie: playerCookie } })).json()).toEqual([
      expect.objectContaining({ slot: 10, macro: expect.objectContaining({ id: macro.id }) }),
    ]);
    expect(await (await api(`/api/rooms/${room.slug}/macros/hotbar`, { headers: { cookie: hostCookie } })).json()).toEqual([
      expect.objectContaining({ slot: 1, macro: expect.objectContaining({ id: macro.id }) }),
    ]);
    expect((await api(`/api/rooms/${room.slug}/macros/${macro.id}`, {
      method: 'DELETE', headers: { cookie: hostCookie, origin: 'https://table.test' },
    })).status).toBe(200);
    expect(await (await api(`/api/rooms/${room.slug}/macros`, { headers: { cookie: hostCookie } })).json()).toEqual([]);
    expect(await (await api(`/api/rooms/${room.slug}/macros/hotbar`, { headers: { cookie: hostCookie } })).json()).toEqual([]);
    expect(await (await api(`/api/rooms/${room.slug}/macros/hotbar`, { headers: { cookie: playerCookie } })).json()).toEqual([]);
  });

  it('persists document folders, tabletop libraries, action history, settings, and deduplicated assets', async () => {
    const me = await api('/api/me');
    const hostCookie = sessionCookie(me);
    const created = await api('/api/rooms', {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ roomName: 'Tabletop tools room' }),
    });
    const { room } = await created.json() as RoomResponse;
    const headers = { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' };

    const folderResponse = await api(`/api/rooms/${room.slug}/folders/actor`, {
      method: 'POST', headers, body: JSON.stringify({ name: '玩家角色' }),
    });
    expect(folderResponse.status).toBe(201);
    const folder = await folderResponse.json() as { id: string; name: string };
    const childFolderResponse = await api(`/api/rooms/${room.slug}/folders/actor`, {
      method: 'POST', headers, body: JSON.stringify({ name: '子目录', parentId: folder.id }),
    });
    const childFolder = await childFolderResponse.json() as { id: string };
    const grandchildFolderResponse = await api(`/api/rooms/${room.slug}/folders/actor`, {
      method: 'POST', headers, body: JSON.stringify({ name: '孙目录', parentId: childFolder.id }),
    });
    const grandchildFolder = await grandchildFolderResponse.json() as { id: string };
    expect((await api(`/api/rooms/${room.slug}/folders/actor/${folder.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ parentId: grandchildFolder.id }),
    })).status).toBe(400);
    const actorResponse = await api(`/api/rooms/${room.slug}/actors`, {
      method: 'POST', headers, body: JSON.stringify({ name: '目录勇士', actorType: 'character' }),
    });
    const actor = await actorResponse.json() as { id: string };
    expect((await api(`/api/rooms/${room.slug}/actors/${actor.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ folderId: folder.id, sort: 10 }),
    })).status).toBe(200);
    expect(await (await api(`/api/rooms/${room.slug}/folders/actor`, { headers: { cookie: hostCookie } })).json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: folder.id, name: '玩家角色' }),
      expect.objectContaining({ id: childFolder.id, parentId: folder.id }),
      expect.objectContaining({ id: grandchildFolder.id, parentId: childFolder.id }),
    ]));
    expect(await (await api(`/api/rooms/${room.slug}/actors`, { headers: { cookie: hostCookie } })).json()).toMatchObject({
      actors: [expect.objectContaining({ id: actor.id, folderId: folder.id, sort: 10 })],
    });

    const itemResponse = await api(`/api/rooms/${room.slug}/tools/items`, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: '长剑', folder: '装备/武器', ownership: { default: 'observer', users: {} },
        data: { itemType: 'weapon', description: '一把长剑。', system: {}, actions: [], effects: [] },
      }),
    });
    expect(itemResponse.status).toBe(201);
    const item = await itemResponse.json() as { id: string };
    const locked = await api(`/api/rooms/${room.slug}/tools/items/${item.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ locked: true }),
    });
    expect(await locked.json()).toMatchObject({ id: item.id, locked: true, folder: '装备/武器' });
    expect((await api(`/api/rooms/${room.slug}/tools/items/${item.id}`, { method: 'DELETE', headers })).status).toBe(409);

    const logged = await api(`/api/rooms/${room.slug}/action-log`, {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'roll', label: '力量检定', formula: '1d20+3', total: 17, details: { mode: 'normal' } }),
    });
    expect(logged.status).toBe(201);
    expect(await (await api(`/api/rooms/${room.slug}/action-log`, { headers: { cookie: hostCookie } })).json()).toEqual([
      expect.objectContaining({ type: 'roll', label: '力量检定', formula: '1d20+3', total: 17 }),
    ]);

    const settings = await api(`/api/rooms/${room.slug}/settings`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ compactMode: true, fontScale: 9, keybindings: { 'ui.toggle-dice': 'Shift+D' } }),
    });
    expect(await settings.json()).toMatchObject({ compactMode: true, fontScale: 1.4, keybindings: { 'ui.toggle-dice': 'Shift+D' } });

    const upload = () => {
      const form = new FormData();
      form.append('file', new File([tinyPng], 'same-map.png', { type: 'image/png' }));
      form.append('kind', 'map');
      return api(`/api/rooms/${room.slug}/assets`, { method: 'POST', headers: { cookie: hostCookie, origin: 'https://table.test' }, body: form });
    };
    const firstAssetResponse = await upload();
    const secondAssetResponse = await upload();
    expect(firstAssetResponse.status).toBe(201);
    expect(secondAssetResponse.status).toBe(201);
    const firstAsset = await firstAssetResponse.json() as { id: string };
    const secondAsset = await secondAssetResponse.json() as { id: string };
    expect(secondAsset.id).toBe(firstAsset.id);
    expect(await (await api(`/api/rooms/${room.slug}/asset-library`, { headers: { cookie: hostCookie } })).json()).toEqual([
      expect.objectContaining({ id: firstAsset.id, name: 'same-map.png', archived: false }),
    ]);
  });

  it('lets only the host delete a room and revokes its members, invites, assets, and live state', async () => {
    const hostMe = await api('/api/me');
    const hostCookie = sessionCookie(hostMe);
    const created = await api('/api/rooms', {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ roomName: 'Disposable room' }),
    });
    const { room } = await created.json() as RoomResponse;
    const keptCreated = await api('/api/rooms', {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ roomName: 'Room to keep' }),
    });
    const keptRoom = (await keptCreated.json() as RoomResponse).room;

    const inviteResponse = await api(`/api/rooms/${room.slug}/invites`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' }),
    });
    const invite = await inviteResponse.json() as { inviteCode: string };

    const playerMe = await api('/api/me');
    const playerCookie = sessionCookie(playerMe);
    const redemption = await api('/api/invites/redeem', {
      method: 'POST',
      headers: { cookie: playerCookie, origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ token: invite.inviteCode }),
    });
    expect(redemption.status).toBe(200);

    const form = new FormData();
    form.append('file', new File([tinyPng], 'room-map.png', { type: 'image/png' }));
    form.append('kind', 'map');
    const uploaded = await api(`/api/rooms/${room.slug}/assets`, {
      method: 'POST',
      headers: { cookie: hostCookie, origin: 'https://table.test' },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const asset = await uploaded.json() as { id: string; url: string };
    const storedAsset = await env.DB.prepare('SELECT object_key FROM assets WHERE id = ?1')
      .bind(asset.id).first<{ object_key: string }>();
    expect(storedAsset).not.toBeNull();

    const playerDelete = await api(`/api/rooms/${room.slug}`, {
      method: 'DELETE',
      headers: { cookie: playerCookie, origin: 'https://table.test' },
    });
    expect(playerDelete.status).toBe(403);

    const deleted = await api(`/api/rooms/${room.slug}`, {
      method: 'DELETE',
      headers: { cookie: hostCookie, origin: 'https://table.test' },
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });

    const hostRooms = await api('/api/rooms', { headers: { cookie: hostCookie } });
    expect(await hostRooms.json()).toEqual({ rooms: [expect.objectContaining({ slug: keptRoom.slug })] });
    expect((await api(`/api/rooms/${room.slug}`, { headers: { cookie: hostCookie } })).status).toBe(404);
    expect((await api(`/api/rooms/${room.slug}`, { headers: { cookie: playerCookie } })).status).toBe(404);
    expect((await api(`/api/rooms/${keptRoom.slug}`, { headers: { cookie: hostCookie } })).status).toBe(200);

    const reuseInvite = await api('/api/invites/redeem', {
      method: 'POST',
      headers: { cookie: sessionCookie(await api('/api/me')), origin: 'https://table.test', 'content-type': 'application/json' },
      body: JSON.stringify({ token: invite.inviteCode }),
    });
    expect(reuseInvite.status).toBe(404);

    const records = await env.DB.prepare(
      `SELECT r.deleted_at, r.status,
              (SELECT COUNT(*) FROM room_members WHERE room_id = r.id AND status = 'active') AS active_members,
              (SELECT COUNT(*) FROM invites WHERE room_id = r.id AND revoked_at IS NULL) AS active_invites,
              (SELECT COUNT(*) FROM assets WHERE object_key = ?2 AND deleted_at IS NULL) AS active_assets
         FROM rooms r WHERE r.id = ?1`,
    ).bind(room.id, storedAsset?.object_key).first<{
      deleted_at: number | null;
      status: string;
      active_members: number;
      active_invites: number;
      active_assets: number;
    }>();
    expect(records).toMatchObject({ status: 'deleted', active_members: 0, active_invites: 0, active_assets: 0 });
    expect(records?.deleted_at).toEqual(expect.any(Number));
    expect(await env.ROOM_ASSETS.head(storedAsset!.object_key)).toBeNull();

    const audit = await env.DB.prepare(
      `SELECT action, actor_user_id, target_id FROM audit_events
        WHERE room_id = ?1 AND action = 'room.delete'`,
    ).bind(room.id).first<{ action: string; actor_user_id: string; target_id: string }>();
    expect(audit).toMatchObject({ action: 'room.delete', target_id: room.id });
  });
});
